import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { withoutQueryDetails } from '../errors';
import { mailSettings } from './deliver';
import { sendDueReminders } from './reminders';

const SCHEDULER_KEY = Symbol.for('bookit.reminder-scheduler');
const CHECK_INTERVAL_MS = 10_000;

/** Starts with the long-running Node server, without relying on visits or cron. */
export function startReminderScheduler(): void {
  const holder = globalThis as { [SCHEDULER_KEY]?: boolean };
  if (holder[SCHEDULER_KEY] || !process.env.DATABASE_URL) return;
  const mail = mailSettings();
  if (mail.mailer.kind === 'disabled') return;
  holder[SCHEDULER_KEY] = true;
  const log = getLogger();
  const deps = {
    db: getDatabase(),
    clock: getClock(),
    log,
    mail,
    publicUrl: publicBaseUrl(),
    tenant: process.env.BOOKIT_TENANT ?? '',
  };
  async function run(): Promise<void> {
    try {
      await sendDueReminders(deps);
    } catch (error) {
      log.error(
        { event: 'reminders.failed', error_name: error instanceof Error ? error.name : 'unknown' },
        'Reminder check failed',
      );
      reportError(withoutQueryDetails(error), { operation: 'reminders' });
    } finally {
      // Schedule after completion so a slow mail server cannot overlap passes.
      setTimeout(() => void run(), CHECK_INTERVAL_MS).unref();
    }
  }
  void run();
}
