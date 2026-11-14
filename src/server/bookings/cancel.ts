import { and, eq } from 'drizzle-orm';
import { bookings, slots } from '@/db/schema';
import { loadClinicSettings } from '../settings';
import type { BookingDependencies } from './book';
import { BookingError } from './errors';
import { findBookingForPatient, isUuid, type BookingView } from './queries';
import { isLateCancellation } from './rules';

export interface CancelBookingRequest {
  patientId: string;
  bookingId: string;
  expectedRevision?: number;
  expectedLate?: boolean;
}

export interface CancelBookingResult {
  ok: true;
  late: boolean;
  booking: BookingView;
}

export async function cancelBooking(
  deps: BookingDependencies,
  request: CancelBookingRequest,
): Promise<CancelBookingResult> {
  if (!isUuid(request.bookingId)) {
    throw new BookingError('booking_not_found');
  }
  const result = await deps.db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const [locked] = await tx
      .select({ status: bookings.status, startsAt: slots.startsAt, rescheduleCount: bookings.rescheduleCount })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .where(and(eq(bookings.id, request.bookingId), eq(bookings.patientId, request.patientId)))
      .for('update', { of: bookings });
    if (!locked) {
      throw new BookingError('booking_not_found');
    }
    const now = deps.clock.now();
    if (request.expectedRevision !== undefined && request.expectedRevision !== locked.rescheduleCount) {
      throw new BookingError('booking_changed');
    }
    if (locked.status !== 'confirmed') {
      throw new BookingError('booking_not_active');
    }
    const late = isLateCancellation(locked.startsAt, now, settings);
    if (request.expectedLate !== undefined && request.expectedLate !== late) {
      throw new BookingError('booking_changed');
    }
    await tx
      .update(bookings)
      .set({ status: 'cancelled', lateCancellation: late, cancelledAt: now, updatedAt: now })
      .where(eq(bookings.id, request.bookingId));
    const booking = await findBookingForPatient(tx, request.patientId, request.bookingId);
    if (!booking) {
      throw new Error('A booking updated in this transaction could not be read back.');
    }
    deps.log.info({ event: 'booking.cancelled', booking_id: booking.id, late }, 'Booking cancelled');
    return { ok: true as const, late, booking };
  });
  return result;
}
