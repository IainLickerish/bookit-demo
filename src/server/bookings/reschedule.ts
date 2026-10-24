import { and, eq } from 'drizzle-orm';
import { bookings, slots } from '@/db/schema';
import { isUniqueViolation } from '../errors';
import { loadClinicSettings } from '../settings';
import { findBookableSlot } from '../slots/queries';
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
  const { booking, previousSlotId } = await deps.db.transaction(async (tx) => {
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
    return { booking: moved, previousSlotId: locked.slotId };
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
  return booking;
}
