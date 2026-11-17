import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { mailSettings } from '../request-context';
import { sendDueReminders } from './reminders';

const WORKER_KEY = Symbol.for('bookit.reminder-worker');

/** Starts with the Node server, including after a restart. No public trigger or extra service is needed. */
export function startReminderWorker(): void {
  const holder = globalThis as { [WORKER_KEY]?: ReturnType<typeof setInterval> };
  if (holder[WORKER_KEY]) return;
  let running = false;
  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    const clock = getClock();
    const log = getLogger().child({ request_id: newId(clock), operation: 'reminders' });
    try {
      await sendDueReminders({
        db: getDatabase(),
        clock,
        log,
        mail: mailSettings(),
        publicUrl: publicBaseUrl(),
        tenant: process.env.BOOKIT_TENANT ?? '',
      });
    } catch (error) {
      log.error(
        { event: 'reminders.failed', error_name: error instanceof Error ? error.name : 'unknown' },
        'Reminder check failed',
      );
      reportError(error, { operation: 'reminders' });
    } finally {
      running = false;
    }
  }
  holder[WORKER_KEY] = setInterval(() => void tick(), 60_000);
  holder[WORKER_KEY].unref();
  void tick();
}
