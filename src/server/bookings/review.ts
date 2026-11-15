import type { Executor } from '@/db/client';
import type { Clock } from '@/lib/clock';
import { loadClinicSettings } from '@/server/settings';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { BookingError } from './errors';
import { findBookingForPatient } from './queries';
import { assertReschedulable, assertSlotBookable, isLateCancellation } from './rules';

export async function bookingForReview(db: Executor, patientId: string, bookingId: string) {
  const booking = await findBookingForPatient(db, patientId, bookingId);
  if (!booking) throw new BookingError('booking_not_found');
  return { booking, settings: await loadClinicSettings(db) };
}

export async function cancellationReview(db: Executor, clock: Clock, patientId: string, bookingId: string) {
  const review = await bookingForReview(db, patientId, bookingId);
  if (review.booking.status !== 'confirmed') throw new BookingError('booking_not_active');
  return { ...review, late: isLateCancellation(review.booking.startsAt, clock.now(), review.settings) };
}

export async function rescheduleReview(
  db: Executor,
  clock: Clock,
  patientId: string,
  bookingId: string,
  slotId: string,
) {
  const review = await bookingForReview(db, patientId, bookingId);
  const now = clock.now();
  assertReschedulable(review.booking, slotId, now, review.settings);
  const target = await findBookableSlot(db, slotId);
  if (!target) throw new BookingError('slot_not_found');
  assertSlotBookable(target.startsAt, now, review.settings);
  if (!(await isSlotFree(db, slotId))) throw new BookingError('slot_unavailable');
  return { ...review, target };
}
