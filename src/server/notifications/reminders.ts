import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import { bookings, clinicSettings, slots } from '@/db/schema';
import { findBookingForPatient } from '../bookings/queries';
import type { BookingDependencies } from '../bookings/book';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import { findUserById } from '../users';
import { deliverEmail } from './deliver';
import { composeReminder } from './reminder';

const DAY_MS = 24 * 60 * 60 * 1000;
export type ReminderDependencies = BookingDependencies & { publicUrl: URL; tenant: string };

/** Every replica may run this. Booking row locks and committed claims prevent duplicate attempts. */
export async function sendDueReminders(deps: ReminderDependencies): Promise<void> {
  // Nothing is claimed when mail is disabled, so configuring SMTP later still works.
  if (deps.mail.mailer.kind === 'disabled') return;
  try {
    if (!(await loadClinicSettings(deps.db)).remindersEnabled) return;
    const now = deps.clock.now();
    const due = await deps.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          isNull(bookings.reminderAttemptedAt),
          gt(slots.startsAt, now),
          lte(slots.startsAt, new Date(now.getTime() + DAY_MS)),
        ),
      )
      .orderBy(asc(slots.startsAt), asc(bookings.id))
      .limit(100);
    for (const candidate of due) {
      const claimed = await deps.db.transaction(async (tx) => {
        const [row] = await tx.select().from(bookings).where(eq(bookings.id, candidate.id)).for('update');
        if (!row || row.reminderAttemptedAt || row.status !== 'confirmed') return false;
        // Read the joined slot after acquiring the lock, in case a move just committed.
        const booking = await findBookingForPatient(tx, row.patientId, row.id);
        const time = deps.clock.now();
        if (!booking || !isDue(booking.startsAt, time)) return false;
        await tx.update(bookings).set({ reminderAttemptedAt: time }).where(eq(bookings.id, row.id));
        return true;
      });
      if (!claimed) continue;
      // Commit the claim BEFORE SMTP. A crash or ambiguous SMTP error must not
      // cause a second email. This deliberately favours at most once over retry.
      await deps.db.transaction(async (tx) => {
        // Hold settings and booking locks through delivery, serialising a send
        // with disabling reminders, cancelling or moving this booking.
        await tx.select({ id: clinicSettings.id }).from(clinicSettings).where(eq(clinicSettings.id, 1)).for('share');
        const settings = await loadClinicSettings(tx);
        const [row] = await tx.select().from(bookings).where(eq(bookings.id, candidate.id)).for('update');
        if (!row || row.status !== 'confirmed') return;
        const booking = await findBookingForPatient(tx, row.patientId, row.id);
        if (!settings.remindersEnabled || !booking || !isDue(booking.startsAt, deps.clock.now())) {
          // A move to a later time or a settings change before delivery has not
          // used the reminder. It can be claimed again when it becomes due.
          await tx.update(bookings).set({ reminderAttemptedAt: null }).where(eq(bookings.id, row.id));
          return;
        }
        const patient = await findUserById(tx, row.patientId);
        if (!patient || patient.role !== 'patient') return;
        const email = composeReminder({ ...deps, booking, patient, settings, from: deps.mail.from });
        await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: row.id });
      });
    }
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}

function isDue(startsAt: Date, now: Date): boolean {
  const remaining = startsAt.getTime() - now.getTime();
  return remaining > 0 && remaining <= DAY_MS;
}
