import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { nextRequestId } from '@/lib/request-id';
import { publicBaseUrl, runtimeIdentity } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { withoutQueryDetails } from '../errors';
import { mailSettings } from './deliver';
import { createSmtpMailer } from './mailer';
import { sendDueBookingReminders } from './reminders';

const SCHEDULE_KEY = Symbol.for('bookit.reminderSchedule');
const CHECK_INTERVAL_MS = 15_000;

export function startBookingReminderSchedule(): void {
  const holder = globalThis as { [SCHEDULE_KEY]?: boolean };
  const smtpUrl = process.env.BOOKIT_SMTP_URL?.trim();
  if (holder[SCHEDULE_KEY] || !smtpUrl || !process.env.DATABASE_URL) return;

  const db = getDatabase();
  const clock = getClock();
  const publicUrl = publicBaseUrl();
  const { tenant } = runtimeIdentity();
  // Keep the booking lock short if the SMTP server becomes unresponsive.
  const mail = mailSettings(createSmtpMailer(smtpUrl, 5_000));
  holder[SCHEDULE_KEY] = true;

  async function check(): Promise<void> {
    const requestId = nextRequestId(false);
    const log = getLogger().child({ request_id: requestId });
    try {
      await sendDueBookingReminders({ db, clock, log, mail, tenant, publicUrl });
    } catch (error) {
      const safeError = withoutQueryDetails(error);
      log.error({ event: 'email.reminder.check_failed', err: safeError }, 'Could not check for due reminders');
      reportError(safeError, { operation: 'check_booking_reminders', request_id: requestId });
    } finally {
      setTimeout(() => void check(), CHECK_INTERVAL_MS).unref();
    }
  }

  void check();
}
