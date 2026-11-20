import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database, Transaction } from '@/db/client';
import { bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { deliverEmail, type MailSettings } from './deliver';
import { composeReminder } from './reminder-email';

interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  publicUrl: URL;
}

const REMINDER_HOURS = 24;
const REMINDERS_PER_RUN = 100;

function dueAt(now: Date) {
  return and(
    eq(bookings.status, 'confirmed'),
    gt(slots.startsAt, now),
    lte(slots.startsAt, addHours(now, REMINDER_HOURS)),
  );
}

async function claimReminder(tx: Transaction, now: Date): Promise<string | undefined> {
  const [due] = await tx
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(clinicSettings, eq(clinicSettings.remindersEnabled, true))
    .where(and(isNull(bookings.reminderAttemptedAt), dueAt(now)))
    .orderBy(asc(slots.startsAt), asc(bookings.id))
    .limit(1)
    .for('update', { of: bookings, skipLocked: true });
  if (!due) return;

  // Commit the claim before starting SMTP. An uncertain outcome must not
  // clear the record, since the mail service could have accepted the email.
  await tx.update(bookings).set({ reminderAttemptedAt: now }).where(eq(bookings.id, due.bookingId));
  return due.bookingId;
}

async function sendClaimedReminder(tx: Transaction, bookingId: string, deps: ReminderDependencies): Promise<void> {
  // Hold the setting and booking through the hand-off so concurrent changes
  // either finish before this check or take effect after the send.
  const [setting] = await tx
    .select({
      clinicName: clinicSettings.clinicName,
      timeZone: clinicSettings.timeZone,
      remindersEnabled: clinicSettings.remindersEnabled,
    })
    .from(clinicSettings)
    .for('share');
  await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId)).for('update');
  const [session] = await tx
    .select({
      startsAt: slots.startsAt,
      practitionerName: practitioners.name,
      patientName: users.name,
      patientEmail: users.email,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(and(eq(bookings.id, bookingId), dueAt(deps.clock.now())));
  if (!setting?.remindersEnabled || !session) {
    await tx.update(bookings).set({ reminderAttemptedAt: null }).where(eq(bookings.id, bookingId));
    return;
  }

  const email = composeReminder({ ...session, ...setting, bookingId, from: deps.mail.from, publicUrl: deps.publicUrl });
  await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: bookingId });
}

/** Dispatch each due booking at most once, including across workers and restarts. */
export async function sendDueReminders(deps: ReminderDependencies): Promise<void> {
  const { db, clock, mail } = deps;
  if (mail.mailer.kind === 'disabled') return;
  for (let index = 0; index < REMINDERS_PER_RUN; index++) {
    const bookingId = await db.transaction((tx) => claimReminder(tx, clock.now()));
    if (!bookingId) return;
    await db.transaction((tx) => sendClaimedReminder(tx, bookingId, deps));
  }
}
