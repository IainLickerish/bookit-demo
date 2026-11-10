import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { getMailer } from './mailer';
import { sendDueReminders } from './reminder';

const WORKER_KEY = Symbol.for('bookit.reminder-worker');

/** One loop per server process. Database claims also protect multiple servers. */
export function startReminderWorker(): void {
  const holder = globalThis as { [WORKER_KEY]?: ReturnType<typeof setInterval> };
  if (holder[WORKER_KEY]) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendDueReminders({
        db: getDatabase(),
        clock: getClock(),
        log: getLogger(),
        mail: { mailer: getMailer(), from: (process.env.BOOKIT_MAIL_FROM ?? '').trim() || 'noreply@bookit.test' },
        publicUrl: publicBaseUrl(),
      });
    } catch (error) {
      getLogger().error(
        { event: 'reminder.worker_failed', error_name: error instanceof Error ? error.name : 'unknown' },
        'Reminder check failed',
      );
    } finally {
      running = false;
    }
  };
  holder[WORKER_KEY] = setInterval(() => void tick(), 60_000);
  holder[WORKER_KEY].unref();
  void tick();
}
