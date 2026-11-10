import { and, eq } from 'drizzle-orm';
import { bookings, slots } from '@/db/schema';
import { isUniqueViolation } from '../errors';
import { composeConfirmation } from '../notifications/confirmation';
import { deliverEmail } from '../notifications/deliver';
import type { OutgoingEmail } from '../notifications/mailer';
import { loadClinicSettings, type ClinicSettings } from '../settings';
import { findBookableSlot } from '../slots/queries';
import { findUserById } from '../users';
import type { BookingDependencies } from './book';
import { BookingError } from './errors';
import { findBookingForPatient, isUuid, ONE_CONFIRMED_BOOKING_PER_SLOT, type BookingView } from './queries';
import { assertReschedulable, assertSlotBookable } from './rules';

export interface RescheduleBookingRequest {
  patientId: string;
  bookingId: string;
  newSlotId: string;
}

export async function rescheduleBooking(
  deps: BookingDependencies,
  request: RescheduleBookingRequest,
): Promise<BookingView> {
  if (!isUuid(request.bookingId)) {
    throw new BookingError('booking_not_found');
  }
  const now = deps.clock.now();
  const { booking, previousSlotId, settings, patient } = await deps.db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const [locked] = await tx
      .select({
        status: bookings.status,
        slotId: bookings.slotId,
        rescheduleCount: bookings.rescheduleCount,
        startsAt: slots.startsAt,
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .where(and(eq(bookings.id, request.bookingId), eq(bookings.patientId, request.patientId)))
      .for('update', { of: bookings });
    if (!locked) {
      throw new BookingError('booking_not_found');
    }
    assertReschedulable(locked, request.newSlotId, now, settings);
    const target = await findBookableSlot(tx, request.newSlotId);
    if (!target) {
      throw new BookingError('slot_not_found');
    }
    assertSlotBookable(target.startsAt, now, settings);
    try {
      await tx
        .update(bookings)
        .set({
          slotId: target.id,
          rescheduleCount: locked.rescheduleCount + 1,
          updatedAt: now,
        })
        .where(eq(bookings.id, request.bookingId));
    } catch (error) {
      if (isUniqueViolation(error, ONE_CONFIRMED_BOOKING_PER_SLOT)) {
        throw new BookingError('slot_unavailable');
      }
      throw error;
    }
    const moved = await findBookingForPatient(tx, request.patientId, request.bookingId);
    if (!moved) {
      throw new Error('A booking updated in this transaction could not be read back.');
    }
    const patient = await findUserById(tx, request.patientId);
    return { booking: moved, previousSlotId: locked.slotId, settings, patient };
  });
  deps.log.info(
    {
      event: 'booking.rescheduled',
      booking_id: booking.id,
      from_slot_id: previousSlotId,
      to_slot_id: booking.slotId,
      reschedule_count: booking.rescheduleCount,
    },
    'Booking rescheduled',
  );
  const confirmation = composeMovedConfirmation(deps, booking, settings, patient);
  if (confirmation) {
    // A failed email never undoes the move; the patient still sees it in "My bookings".
    await deliverEmail(deps.mail, deps.log, confirmation, 'confirmation', { booking_id: booking.id });
  }
  return booking;
}

/**
 * The "booking moved" confirmation, with the new time's calendar file. It is
 * composed after the move has committed, so a problem composing it is
 * logged and the move still stands.
 */
function composeMovedConfirmation(
  deps: BookingDependencies,
  booking: BookingView,
  settings: ClinicSettings,
  patient: { email: string; name: string } | null,
): OutgoingEmail | null {
  if (!patient) {
    return null;
  }
  try {
    return composeConfirmation({
      booking,
      patient,
      settings,
      from: deps.mail.from,
      kind: 'rescheduled',
      now: deps.clock.now(),
    });
  } catch (error) {
    deps.log.error(
      {
        event: 'email.confirmation.failed',
        booking_id: booking.id,
        error_name: error instanceof Error ? error.name : 'unknown',
      },
      'Email failed',
    );
    return null;
  }
}
