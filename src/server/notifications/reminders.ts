import { and, asc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { bookings, clinicSettings, slots } from '@/db/schema';
import type { BookingDependencies } from '../bookings/book';
import { findBookingForPatient } from '../bookings/queries';
import { loadClinicSettings } from '../settings';
import { findUserById } from '../users';
import { deliverEmail } from './deliver';
import { composeReminder, REMINDER_LEAD_MS, reminderIsDue } from './reminder';

export interface ReminderDependencies extends BookingDependencies {
  /** The configured clinic origin, never a request Host header. */
  publicUrl: URL;
  tenant: string;
}

/** One bounded pass, shared by automatic runs and integration tests. */
export async function sendDueReminders(deps: ReminderDependencies): Promise<void> {
  if (deps.mail.mailer.kind === 'disabled') return;
  const settings = await loadClinicSettings(deps.db);
  if (!settings.remindersEnabled) return;
  const now = deps.clock.now();
  const dueSlots = deps.db
    .select({ id: slots.id })
    .from(slots)
    .where(and(gt(slots.startsAt, now), lte(slots.startsAt, new Date(now.getTime() + REMINDER_LEAD_MS))));
  const candidates = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(eq(bookings.status, 'confirmed'), isNull(bookings.reminderAttemptedAt), inArray(bookings.slotId, dueSlots)),
    )
    .orderBy(asc(bookings.id))
    .limit(100);

  for (const candidate of candidates) {
    // Commit the claim BEFORE contacting SMTP. A crash or uncertain SMTP response
    // must not allow another process or restart to send a second reminder.
    const claimed = await deps.db
      .update(bookings)
      .set({ reminderAttemptedAt: deps.clock.now() })
      .where(and(eq(bookings.id, candidate.id), isNull(bookings.reminderAttemptedAt)))
      .returning({ patientId: bookings.patientId });
    const owner = claimed[0];
    if (!owner) continue;

    await deps.db.transaction(async (tx) => {
      // Shared settings locks allow deliveries together, but switching off waits
      // for in-flight sends. The booking lock also serialises moves/cancellations.
      await tx.select({ id: clinicSettings.id }).from(clinicSettings).where(eq(clinicSettings.id, 1)).for('share');
      await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, candidate.id)).for('update');
      const currentSettings = await loadClinicSettings(tx);
      const booking = await findBookingForPatient(tx, owner.patientId, candidate.id);
      if (!booking) throw new Error('The claimed reminder booking could not be read back.');
      if (
        !currentSettings.remindersEnabled ||
        booking.status !== 'confirmed' ||
        !reminderIsDue(booking.startsAt, deps.clock.now())
      ) {
        // No email was attempted. An unreminded move or re-enabled clinic can
        // still receive its reminder when the current appointment is due.
        await tx.update(bookings).set({ reminderAttemptedAt: null }).where(eq(bookings.id, candidate.id));
        return;
      }
      const patient = await findUserById(tx, booking.patientId);
      if (!patient || patient.role !== 'patient') return;
      const email = composeReminder({
        booking,
        patient,
        settings: currentSettings,
        from: deps.mail.from,
        publicUrl: deps.publicUrl,
        tenant: deps.tenant,
      });
      await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: booking.id });
    });
  }
}
