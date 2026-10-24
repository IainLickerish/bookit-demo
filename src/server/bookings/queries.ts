import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { bookings, practitioners, slots } from '@/db/schema';

export interface BookingView {
  id: string;
  patientId: string;
  status: 'confirmed' | 'cancelled';
  lateCancellation: boolean;
  phone: string | null;
  rescheduleCount: number;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  slotId: string;
  startsAt: Date;
  endsAt: Date;
  practitionerId: string;
  practitionerName: string;
}

const bookingViewColumns = {
  id: bookings.id,
  patientId: bookings.patientId,
  status: bookings.status,
  lateCancellation: bookings.lateCancellation,
  phone: bookings.phone,
  rescheduleCount: bookings.rescheduleCount,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
  cancelledAt: bookings.cancelledAt,
  slotId: slots.id,
  startsAt: slots.startsAt,
  endsAt: slots.endsAt,
  practitionerId: practitioners.id,
  practitionerName: practitioners.name,
};

export const ONE_CONFIRMED_BOOKING_PER_SLOT = 'booking_one_confirmed_per_slot';

export function isUuid(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}

export async function listBookingsForPatient(db: Executor, patientId: string): Promise<BookingView[]> {
  return db
    .select(bookingViewColumns)
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(eq(bookings.patientId, patientId))
    .orderBy(asc(slots.startsAt), asc(bookings.id));
}

/** A patient's own booking; another patient's booking is "not found". */
export async function findBookingForPatient(
  db: Executor,
  patientId: string,
  bookingId: string,
): Promise<BookingView | null> {
  if (!isUuid(bookingId)) {
    return null;
  }
  const [row] = await db
    .select(bookingViewColumns)
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.patientId, patientId)));
  return row ?? null;
}
