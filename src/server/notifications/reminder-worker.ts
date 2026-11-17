import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { loadTenant } from '../seed/tenant';
import { getMailer } from './mailer';
import { sendDueReminders, type ReminderDependencies } from './reminders';

export function reminderDependencies(): ReminderDependencies {
  const tenant = loadTenant(process.env.BOOKIT_TENANT);
  return {
    db: getDatabase(),
    clock: getClock(),
    log: getLogger(),
    mail: { mailer: getMailer(), from: process.env.BOOKIT_MAIL_FROM?.trim() || tenant.mailFrom },
    publicUrl: publicBaseUrl(),
    words: {
      booking: tenant.tenant === 'acme' ? 'session' : 'appointment',
      practitioner: tenant.branding.practitionerLabel,
    },
  };
}

const WORKER_KEY = Symbol.for('bookit.reminder-worker');

/** One worker per Node process; the database claim also protects across processes. */
export function startReminderWorker(): void {
  if (!process.env.DATABASE_URL || !process.env.BOOKIT_SMTP_URL) return;
  const holder = globalThis as { [WORKER_KEY]?: NodeJS.Timeout };
  if (holder[WORKER_KEY]) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendDueReminders(reminderDependencies());
    } catch (error) {
      getLogger().error(
        { event: 'reminders.failed', error_name: error instanceof Error ? error.name : 'unknown' },
        'Reminder check failed',
      );
      reportError(new Error('Reminder check failed'), { operation: 'reminders' });
    } finally {
      running = false;
    }
  };
  holder[WORKER_KEY] = setInterval(() => void tick(), 60_000);
  holder[WORKER_KEY].unref();
  void tick();
}
