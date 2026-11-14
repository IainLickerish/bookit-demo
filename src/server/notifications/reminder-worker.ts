import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { mailSettings } from '../request-context';
import { sendDueReminders } from './reminders';

const WORKER_KEY = Symbol.for('bookit.reminder-worker');

/** Each app process polls automatically; durable database claims coordinate replicas. */
export function startReminderWorker(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || !process.env.DATABASE_URL) return;
  const holder = globalThis as { [WORKER_KEY]?: NodeJS.Timeout };
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
        mail: mailSettings(),
        publicUrl: publicBaseUrl(),
      });
    } catch {
      // Never log query details, recipient addresses or email bodies.
      getLogger().error({ event: 'reminder.worker.failed' }, 'Reminder check failed');
    } finally {
      running = false;
    }
  };
  holder[WORKER_KEY] = setInterval(() => {
    void tick();
  }, 30_000);
  holder[WORKER_KEY].unref();
  void tick();
}
