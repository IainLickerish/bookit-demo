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

const REMINDER_CHECK_MS = 60_000;
const SCHEDULE_KEY = Symbol.for('bookit.reminderSchedule');

export function startReminderSchedule(): void {
  const holder = globalThis as { [SCHEDULE_KEY]?: true };
  if (holder[SCHEDULE_KEY]) return;
  const mail = mailSettings();
  if (mail.mailer.kind === 'disabled') return;
  const baseUrl = publicBaseUrl();
  holder[SCHEDULE_KEY] = true;

  async function run(): Promise<void> {
    const log = getLogger().child({ request_id: nextRequestId(testClockAllowedByBuild()) });
    try {
      await sendDueReminders({ db: getDatabase(), clock: getClock(), log, mail }, baseUrl);
    } catch (error) {
      const safeError = withoutQueryDetails(error);
      log.error(
        { event: 'reminders.check_failed', error_name: safeError instanceof Error ? safeError.name : 'unknown' },
        'Session reminders could not be checked',
      );
      reportError(safeError, { operation: 'reminders.check' });
    }
  }

  function schedule() {
    setTimeout(() => void run().finally(schedule), REMINDER_CHECK_MS).unref();
  }

  schedule();
}
