import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { bookings, clinicSettings, slots } from '@/db/schema';
import { addHours } from '@/lib/time';
import type { BookingDependencies } from '../bookings/book';
import { findBookingForPatient } from '../bookings/queries';
import { loadClinicSettings } from '../settings';
import { findUserById } from '../users';
import { deliverEmail } from './deliver';
import { composeReminder, reminderDue, REMINDER_EARLIEST_HOURS, REMINDER_LATEST_HOURS } from './reminder';

/**
 * Claim durably BEFORE contacting SMTP. An interrupted or failed attempt is
 * never retried: SMTP may have accepted mail even when its reply was lost.
 * A successful move clears the markers for the new booking revision.
 */
export async function sendDueReminders(
  deps: BookingDependencies & { publicUrl: URL; tenant?: string },
): Promise<number> {
  if (deps.mail.mailer.kind === 'disabled') return 0;
  let sent = 0;
  for (;;) {
    const claim = await deps.db.transaction(async (tx) => {
      const now = deps.clock.now();
      if (!(await loadClinicSettings(tx)).remindersEnabled) return null;
      const [candidate] = await tx
        .select({ id: bookings.id, revision: bookings.rescheduleCount })
        .from(bookings)
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .where(
          and(
            eq(bookings.status, 'confirmed'),
            isNull(bookings.reminderAttemptedAt),
            gte(slots.startsAt, addHours(now, REMINDER_LATEST_HOURS)),
            lte(slots.startsAt, addHours(now, REMINDER_EARLIEST_HOURS)),
          ),
        )
        .orderBy(asc(slots.startsAt), asc(bookings.id))
        .limit(1)
        .for('update', { of: bookings, skipLocked: true });
      if (!candidate) return null;
      await tx.update(bookings).set({ reminderAttemptedAt: now }).where(eq(bookings.id, candidate.id));
      return candidate;
    });
    if (!claim) return sent;
    const delivered = await deps.db.transaction(async (tx) => {
      // A saved disable waits for an in-progress send. Once it returns, no
      // worker can send another reminder until reminders are enabled again.
      const [settings] = await tx.select().from(clinicSettings).where(eq(clinicSettings.id, 1)).for('share');
      const [locked] = await tx.select().from(bookings).where(eq(bookings.id, claim.id)).for('update');
      if (
        !settings?.remindersEnabled ||
        !locked ||
        locked.status !== 'confirmed' ||
        locked.rescheduleCount !== claim.revision
      )
        return false;
      const booking = await findBookingForPatient(tx, locked.patientId, locked.id);
      if (!booking || !reminderDue(booking.startsAt, deps.clock.now())) return false;
      const patient = await findUserById(tx, locked.patientId);
      if (!patient || patient.role !== 'patient') return false;
      // Hold the booking lock while sending so a cancellation or move cannot
      // commit first and then be followed by an email for the old time.
      const delivered = await deliverEmail(
        deps.mail,
        deps.log,
        composeReminder({
          booking,
          patient,
          settings,
          from: deps.mail.from,
          publicUrl: deps.publicUrl,
          tenant: deps.tenant,
        }),
        'reminder',
        { booking_id: booking.id, revision: String(claim.revision) },
      );
      if (delivered) {
        await tx.update(bookings).set({ reminderSentAt: deps.clock.now() }).where(eq(bookings.id, booking.id));
      }
      return delivered;
    });
    if (delivered) sent++;
  }
}
