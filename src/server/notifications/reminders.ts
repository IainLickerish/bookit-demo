import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import { bookingActionPath } from '@/lib/booking-links';
import { bookings, slots } from '@/db/schema';
import { addHours, addMinutes, formatSlot } from '@/lib/time';
import type { BookingDependencies } from '../bookings/book';
import { findBookingForPatient } from '../bookings/queries';
import { loadClinicSettings } from '../settings';
import { findUserById } from '../users';
import { deliverEmail } from './deliver';

const REMINDER_HOURS = 24;
const REMINDER_WINDOW_MINUTES = 5;
const awaitingReminder = and(eq(bookings.status, 'confirmed'), isNull(bookings.reminderAttemptedAt));

function reminderWindow(now: Date) {
  const latest = addHours(now, REMINDER_HOURS);
  return { earliest: addMinutes(latest, -REMINDER_WINDOW_MINUTES), latest };
}

async function claimReminder(deps: BookingDependencies, bookingId: string, baseUrl: URL) {
  return deps.db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx, 'share');
    if (!settings.reminderEmailsEnabled) return null;

    // The same booking row is locked when it is moved or cancelled. Read its
    // current slot after acquiring the lock, since the initial list may be stale.
    const [locked] = await tx
      .select({ patientId: bookings.patientId })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), awaitingReminder))
      .for('update', { skipLocked: true });
    if (!locked) return null;
    const booking = await findBookingForPatient(tx, locked.patientId, bookingId);
    const patient = await findUserById(tx, locked.patientId);
    if (!booking || patient?.role !== 'patient') return null;
    const now = deps.clock.now();
    const { earliest, latest } = reminderWindow(now);
    if (booking.startsAt <= earliest || booking.startsAt > latest) return null;
    // updatedAt is set when the current slot is first booked or moved.
    if (addHours(booking.updatedAt, REMINDER_HOURS) > booking.startsAt) return null;

    const when = formatSlot(booking.startsAt, settings.timeZone);
    const rescheduleUrl = new URL(bookingActionPath(booking.id, 'reschedule'), baseUrl);
    const cancelUrl = new URL(bookingActionPath(booking.id, 'cancel'), baseUrl);
    const email = {
      from: deps.mail.from,
      to: patient.email,
      subject: 'Reminder for your physiotherapy session',
      text: [
        settings.clinicName,
        '',
        'This is a reminder for your upcoming session.',
        '',
        `When: ${when} (${settings.timeZone})`,
        `Physiotherapist: ${booking.practitionerName}`,
        '',
        `Reschedule your session: ${rescheduleUrl}`,
        `Cancel your session: ${cancelUrl}`,
        '',
      ].join('\n'),
    };
    // Commit the attempt before SMTP. A lost SMTP acknowledgement is
    // ambiguous, and trying again could send a second reminder.
    await tx.update(bookings).set({ reminderAttemptedAt: now }).where(eq(bookings.id, bookingId));
    return email;
  });
}

export async function sendDueReminders(deps: BookingDependencies, baseUrl: URL): Promise<void> {
  if (deps.mail.mailer.kind === 'disabled') return;
  const settings = await loadClinicSettings(deps.db);
  if (!settings.reminderEmailsEnabled) return;

  const { earliest, latest } = reminderWindow(deps.clock.now());
  const candidates = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(and(awaitingReminder, gt(slots.startsAt, earliest), lte(slots.startsAt, latest)))
    .orderBy(asc(slots.startsAt));

  for (const { id } of candidates) {
    const email = await claimReminder(deps, id, baseUrl);
    if (email) await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: id });
  }
}
