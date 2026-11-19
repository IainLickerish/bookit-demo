import { getDatabase } from '@/db/client';
import { testClockAllowedByBuild } from '@/lib/build-flags';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { nextRequestId } from '@/lib/request-id';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { mailSettings } from './deliver';
import { sendDueBookingReminders } from './reminders';

const WORKER_KEY = Symbol.for('bookit.reminderWorker');
const POLL_INTERVAL_MS = 60_000;

export function startReminderWorker(): void {
  const holder = globalThis as { [WORKER_KEY]?: boolean };
  if (holder[WORKER_KEY] || !process.env.DATABASE_URL) return;
  const mail = mailSettings();
  if (mail.mailer.kind === 'disabled') return;

  const db = getDatabase();
  const clock = getClock();
  const publicUrl = publicBaseUrl();
  const logger = getLogger();
  holder[WORKER_KEY] = true;

  async function poll(): Promise<void> {
    const log = logger.child({ request_id: nextRequestId(testClockAllowedByBuild()) });
    try {
      await sendDueBookingReminders({ db, clock, log, mail, publicUrl });
    } catch (error) {
      log.error({ event: 'reminder.poll_failed', err: error }, 'Could not check for session reminders');
    } finally {
      setTimeout(() => void poll(), POLL_INTERVAL_MS).unref();
    }
  }

  void poll();
}
