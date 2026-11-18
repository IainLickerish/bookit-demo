import { createDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { nextRequestId } from '@/lib/request-id';
import { publicBaseUrl, runtimeIdentity } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { DatabaseError, withoutQueryDetails } from '../errors';
import { mailSettings, type MailSettings } from './deliver';
import { createSmtpMailer } from './mailer';
import { sendDueBookingReminders } from './reminders';

const SCHEDULE_KEY = Symbol.for('bookit.reminderSchedule');
const CHECK_INTERVAL_MS = 15_000;

function runSchedule(databaseUrl: string, smtpUrl: string): void {
  let mail: MailSettings;
  try {
    mail = mailSettings(createSmtpMailer(smtpUrl, 5_000));
  } catch {
    // Transport setup errors can contain the SMTP URL and credentials.
    getLogger().error(
      { event: 'email.reminder.configuration_failed', request_id: nextRequestId(false) },
      'Could not configure reminder email transport',
    );
    return;
  }

  // The worker needs one connection to hold the delivery locks and one to
  // commit the attempt. Booking requests cannot exhaust this pool.
  const { db, pool } = createDatabase(databaseUrl, { max: 2 });
  pool.on('error', () => {
    getLogger().error(
      { event: 'email.reminder.connection_failed', request_id: nextRequestId(false) },
      'Reminder database connection lost',
    );
  });
  const clock = getClock();
  const publicUrl = publicBaseUrl();
  const { tenant } = runtimeIdentity();

  async function check(): Promise<void> {
    const requestId = nextRequestId(false);
    const log = getLogger().child({ request_id: requestId });
    try {
      await sendDueBookingReminders({ db, clock, log, mail, tenant, publicUrl });
    } catch (error) {
      const safeError = withoutQueryDetails(error);
      const reported = safeError instanceof DatabaseError ? safeError : new Error('Could not check for due reminders');
      log.error({ event: 'email.reminder.check_failed', err: reported }, 'Could not check for due reminders');
      reportError(reported, { operation: 'check_booking_reminders', request_id: requestId });
    } finally {
      setTimeout(() => void check(), CHECK_INTERVAL_MS).unref();
    }
  }

  void check();
}

export function startBookingReminderSchedule(): void {
  const holder = globalThis as { [SCHEDULE_KEY]?: boolean };
  const smtpUrl = process.env.BOOKIT_SMTP_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL;
  if (holder[SCHEDULE_KEY] || !smtpUrl || !databaseUrl) return;

  holder[SCHEDULE_KEY] = true;
  setImmediate(() => runSchedule(databaseUrl, smtpUrl)).unref();
}
