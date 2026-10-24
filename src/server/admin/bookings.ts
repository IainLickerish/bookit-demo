import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { bookings, practitioners, slots, users } from '@/db/schema';
import { addDaysToLocalDate, isLocalDate, startOfLocalDate } from '@/lib/time';

export const bookingFiltersSchema = z.strictObject({
  practitionerId: z.uuid().optional(),
  date: z.string().refine(isLocalDate).optional(),
  status: z.enum(['confirmed', 'cancelled']).optional(),
});
export type BookingFilters = z.infer<typeof bookingFiltersSchema>;

/** Never accept tenant/database selectors or ambiguous repeated query parameters. */
export function parseBookingFilters(params: URLSearchParams): BookingFilters {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) throw new Error('Invalid booking filters');
    values[key] = value;
  }
  for (const key of ['practitionerId', 'date', 'status']) {
    if (values[key] === '') delete values[key];
  }
  const result = bookingFiltersSchema.safeParse(values);
  if (!result.success) throw new Error('Invalid booking filters');
  return result.data;
}

/** The executor belongs to this server's clinic; no request chooses another database. */
export async function listAdminBookings(db: Executor, filters: BookingFilters, timeZone: string) {
  const start = filters.date ? startOfLocalDate(filters.date, timeZone) : undefined;
  const end = filters.date ? startOfLocalDate(addDaysToLocalDate(filters.date, 1), timeZone) : undefined;
  return db
    .select({
      id: bookings.id,
      patientName: users.name,
      practitionerId: practitioners.id,
      practitionerName: practitioners.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
      status: bookings.status,
      lateCancellation: bookings.lateCancellation,
      phone: bookings.phone,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.patientId))
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(
      and(
        filters.practitionerId ? eq(practitioners.id, filters.practitionerId) : undefined,
        filters.status ? eq(bookings.status, filters.status) : undefined,
        start ? gte(slots.startsAt, start) : undefined,
        end ? lt(slots.startsAt, end) : undefined,
      ),
    )
    .orderBy(asc(slots.startsAt), asc(bookings.id));
}

export type AdminBooking = Awaited<ReturnType<typeof listAdminBookings>>[number];

export async function listAdminPractitioners(db: Executor) {
  // Inactive practitioners remain filterable for historical bookings.
  return db
    .select({ id: practitioners.id, name: practitioners.name })
    .from(practitioners)
    .orderBy(asc(practitioners.name), asc(practitioners.id));
}
