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

const SCHEDULE_KEY = Symbol.for('bookit.reminderSchedule');
const CHECK_INTERVAL_MS = 60_000;

/** Check on server start and then once a minute, with no overlapping runs in this process. */
export function startReminderSchedule(): void {
  const holder = globalThis as { [SCHEDULE_KEY]?: boolean };
  const mail = mailSettings();
  if (holder[SCHEDULE_KEY] || mail.mailer.kind === 'disabled') return;

  const publicUrl = publicBaseUrl();
  const clock = getClock();
  holder[SCHEDULE_KEY] = true;
  const check = async () => {
    const requestId = nextRequestId(testClockAllowedByBuild());
    const log = getLogger().child({ request_id: requestId });
    try {
      await sendDueReminders({ db: getDatabase(), clock, log, mail, publicUrl });
    } catch (error) {
      log.error({ event: 'email.reminder.check_failed' }, 'Could not check for session reminders');
      reportError(withoutQueryDetails(error), { operation: 'reminder_check', request_id: requestId });
    } finally {
      setTimeout(() => void check(), CHECK_INTERVAL_MS).unref();
    }
  };
  void check();
}
