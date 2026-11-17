import { and, eq } from 'drizzle-orm';
import { bookings } from '@/db/schema';
import { isUniqueViolation } from '../errors';
import { composeConfirmation } from '../notifications/confirmation';
import { deliverEmail } from '../notifications/deliver';
import { loadClinicSettings } from '../settings';
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
  /** The time shown when the move form was opened, used to recognise a repeated submission. */
  originalSlotId?: string;
}

export async function rescheduleBooking(
  deps: BookingDependencies,
  request: RescheduleBookingRequest,
): Promise<BookingView> {
  if (!isUuid(request.bookingId)) {
    throw new BookingError('booking_not_found');
  }
  const now = deps.clock.now();
  const { booking, previousSlotId, confirmation } = await deps.db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const [owned] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, request.bookingId), eq(bookings.patientId, request.patientId)))
      .for('update');
    if (!owned) {
      throw new BookingError('booking_not_found');
    }
    // Read the slot after acquiring the booking lock. A concurrent move can change
    // the slot while a locking query that joins slots is waiting.
    const locked = await findBookingForPatient(tx, request.patientId, request.bookingId);
    if (!locked) {
      throw new Error('The locked booking could not be read back.');
    }
    // The first submission may already have committed while this one waited for the lock.
    // Return that saved result without using another move or sending another confirmation.
    if (
      locked.status === 'confirmed' &&
      locked.startsAt > now &&
      locked.rescheduleCount > 0 &&
      locked.slotId === request.newSlotId &&
      isUuid(request.originalSlotId ?? '') &&
      request.originalSlotId !== request.newSlotId
    ) {
      return { booking: locked, previousSlotId: locked.slotId, confirmation: null };
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
    const patient = await findUserById(tx, moved.patientId);
    if (!patient) {
      throw new Error('The patient for this booking could not be read back.');
    }
    return {
      booking: moved,
      previousSlotId: locked.slotId,
      confirmation: composeConfirmation({ booking: moved, patient, settings, from: deps.mail.from, kind: 'moved' }),
    };
  });
  if (!confirmation) return booking;
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
  await deliverEmail(deps.mail, deps.log, confirmation, 'confirmation', { booking_id: booking.id });
  return booking;
}
