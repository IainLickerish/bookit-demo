import { getDatabase } from '@/db/client';
import { testClockAllowedByBuild } from '@/lib/build-flags';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { nextRequestId } from '@/lib/request-id';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { withoutQueryDetails } from '../errors';
import { mailSettings } from './deliver';
import { sendDueReminders } from './reminders';

const WORKER_STARTED = Symbol.for('bookit.reminderWorkerStarted');
const POLL_INTERVAL_MS = 30_000;

/** The running Node server checks for reminders even when nobody is using the site. */
export function startReminderWorker(): void {
  const holder = globalThis as { [WORKER_STARTED]?: boolean };
  const mail = mailSettings();
  if (holder[WORKER_STARTED] || mail.mailer.kind === 'disabled') return;
  const publicUrl = publicBaseUrl();
  holder[WORKER_STARTED] = true;

  async function poll(): Promise<void> {
    const requestId = nextRequestId(testClockAllowedByBuild());
    const log = getLogger().child({ request_id: requestId });
    try {
      await sendDueReminders({ db: getDatabase(), clock: getClock(), log, mail, publicUrl });
    } catch (error) {
      const safeError = withoutQueryDetails(error);
      log.error(
        { event: 'reminders.poll.failed', error_name: safeError instanceof Error ? safeError.name : 'unknown' },
        'Session reminders could not be checked',
      );
      reportError(safeError, { operation: 'reminders.poll', request_id: requestId });
    } finally {
      setTimeout(() => void poll(), POLL_INTERVAL_MS).unref();
    }
  }
  void poll();
}
