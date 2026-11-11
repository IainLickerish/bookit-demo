import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { bookings, clinicSettings, slots } from '@/db/schema';
import { formatSlot } from '@/lib/time';
import type { BookingDependencies } from '../bookings/book';
import { findBookingForPatient } from '../bookings/queries';
import { loadClinicSettings } from '../settings';
import { findUserById } from '../users';
import { deliverEmail } from './deliver';
import type { OutgoingEmail } from './mailer';

export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export interface ReminderContent {
  id: string;
  startsAt: Date;
  practitionerName: string;
  patient: { email: string; name: string };
  clinicName: string;
  from: string;
  publicUrl: URL;
}

export function composeReminder(input: ReminderContent): OutgoingEmail {
  const when = formatSlot(input.startsAt, 'Europe/London');
  const reschedule = new URL(`/bookings/${input.id}/reschedule`, input.publicUrl);
  const cancel = new URL(`/bookings#booking-${input.id}`, input.publicUrl);
  return {
    from: input.from,
    to: input.patient.email,
    subject: `Appointment reminder: ${when}`,
    text: [
      `Dear ${input.patient.name},`,
      '',
      `A reminder of your appointment at ${input.clinicName}.`,
      `When: ${when} (UK time, Europe/London)`,
      `With: ${input.practitionerName}`,
      `Booking reference: ${input.id}`,
      '',
      `Reschedule: ${reschedule.href}`,
      `Cancel: ${cancel.href}`,
      'Sign in to manage your booking. Cancellation and rescheduling rules still apply.',
      '',
      input.clinicName,
      '',
    ].join('\n'),
  };
}

export interface ReminderDependencies extends BookingDependencies {
  publicUrl: URL;
}

/**
 * A durable claim is committed before contacting SMTP. We never retry a claim,
 * including after a crash or an ambiguous SMTP failure, to avoid duplicate mail.
 * Read the current slot on every pass, rather than storing a scheduled time.
 */
export async function sendDueReminders(deps: ReminderDependencies): Promise<void> {
  if (deps.mail.mailer.kind === 'disabled') return;
  const now = deps.clock.now();
  const due = and(
    eq(bookings.status, 'confirmed'),
    isNull(bookings.reminderAttemptedAt),
    gt(slots.startsAt, now),
    lte(slots.startsAt, new Date(now.getTime() + REMINDER_LEAD_MS)),
  );
  const candidates = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(due);

  for (const candidate of candidates) {
    const claim = await deps.db.transaction(async (tx) => {
      const [settings] = await tx.select().from(clinicSettings).where(eq(clinicSettings.id, 1)).for('share');
      if (!settings?.remindersEnabled) return null;
      const [booking] = await tx
        .select({ id: bookings.id, patientId: bookings.patientId, slotId: bookings.slotId })
        .from(bookings)
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .where(and(eq(bookings.id, candidate.id), due))
        .for('update', { of: bookings, skipLocked: true });
      if (!booking) return null;
      await tx.update(bookings).set({ reminderAttemptedAt: now }).where(eq(bookings.id, booking.id));
      return booking;
    });
    if (!claim) continue;

    // Keep changes to the booking and settings behind these locks until SMTP
    // finishes (the SMTP transport times out if the server stalls). Recheck
    // after claiming in case a move or cancellation won the gap.
    await deps.db.transaction(async (tx) => {
      await tx.select({ id: clinicSettings.id }).from(clinicSettings).where(eq(clinicSettings.id, 1)).for('share');
      const settings = await loadClinicSettings(tx);
      await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, claim.id)).for('update');
      const booking = await findBookingForPatient(tx, claim.patientId, claim.id);
      const current = deps.clock.now();
      if (
        !settings.remindersEnabled ||
        !booking ||
        booking.status !== 'confirmed' ||
        booking.slotId !== claim.slotId ||
        booking.startsAt <= current ||
        booking.startsAt.getTime() > current.getTime() + REMINDER_LEAD_MS
      ) {
        // No send was attempted, so a moved booking may be claimed at its new time.
        await tx.update(bookings).set({ reminderAttemptedAt: null }).where(eq(bookings.id, claim.id));
        return;
      }
      const patient = await findUserById(tx, claim.patientId);
      if (!patient) throw new Error('The reminder patient could not be found.');
      const email = composeReminder({
        ...booking,
        patient,
        clinicName: settings.clinicName,
        from: deps.mail.from,
        publicUrl: deps.publicUrl,
      });
      await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: booking.id });
    });
  }
}
