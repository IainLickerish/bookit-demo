import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { blockedPeriods, bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { zonedTimeToUtc } from '@/lib/time';

const inputSchema = z.strictObject({
  practitionerId: z.uuid(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  reason: z.string().trim().max(500),
});

export function parseBlockedTime(input: unknown, timeZone: string) {
  const parsed = inputSchema.parse(input);
  const startsAt = zonedTimeToUtc(parsed.start.slice(0, 10), parsed.start.slice(11), timeZone);
  const endsAt = zonedTimeToUtc(parsed.end.slice(0, 10), parsed.end.slice(11), timeZone);
  if (!startsAt || !endsAt || endsAt <= startsAt) throw new Error('Invalid blocked time');
  return { practitionerId: parsed.practitionerId, startsAt, endsAt, reason: parsed.reason || null };
}

export async function createBlockedTime(db: Database, clock: Clock, input: ReturnType<typeof parseBlockedTime>) {
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(eq(practitioners.id, input.practitionerId))
      .for('update');
    if (!person) throw new Error('Unknown practitioner');
    const id = newId(clock);
    await tx.insert(blockedPeriods).values({ ...input, id, createdAt: clock.now() });
    return id;
  });
}

export async function removeBlockedTime(db: Database, id: string) {
  if (!z.uuid().safeParse(id).success) return;
  await db.delete(blockedPeriods).where(eq(blockedPeriods.id, id));
}

export const BLOCKED_TIME_PAGE_SIZE = 20;

export function blockedTimePage(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= Math.floor(2_147_483_647 / BLOCKED_TIME_PAGE_SIZE) ? page : 1;
}

export async function listBlockedTime(db: Executor, page = 1) {
  const periods = await db
    .select({
      id: blockedPeriods.id,
      practitionerName: practitioners.name,
      startsAt: blockedPeriods.startsAt,
      endsAt: blockedPeriods.endsAt,
      reason: blockedPeriods.reason,
    })
    .from(blockedPeriods)
    .innerJoin(practitioners, eq(practitioners.id, blockedPeriods.practitionerId))
    .orderBy(desc(blockedPeriods.createdAt), desc(blockedPeriods.id))
    .limit(BLOCKED_TIME_PAGE_SIZE + 1)
    .offset((page - 1) * BLOCKED_TIME_PAGE_SIZE);
  const displayed = periods.slice(0, BLOCKED_TIME_PAGE_SIZE);
  const overlaps = await bookingsInBlockedTime(
    db,
    displayed.map((period) => period.id),
  );
  const grouped = new Map<string, typeof overlaps>();
  for (const booking of overlaps) {
    const group = grouped.get(booking.blockId) ?? [];
    group.push(booking);
    grouped.set(booking.blockId, group);
  }
  return {
    rows: displayed.map((period) => ({ ...period, bookings: grouped.get(period.id) ?? [] })),
    hasMore: periods.length > BLOCKED_TIME_PAGE_SIZE,
  };
}

/** Only confirmed bookings overlap; touching an endpoint is allowed. */
export async function bookingsInBlockedTime(db: Executor, blockIds: string[]) {
  if (blockIds.length === 0) return [];
  return db
    .select({
      blockId: blockedPeriods.id,
      id: bookings.id,
      patientName: users.name,
      email: users.email,
      phone: bookings.phone,
      startsAt: slots.startsAt,
    })
    .from(blockedPeriods)
    .innerJoin(
      slots,
      and(
        eq(slots.practitionerId, blockedPeriods.practitionerId),
        lt(slots.startsAt, blockedPeriods.endsAt),
        gt(slots.endsAt, blockedPeriods.startsAt),
      ),
    )
    .innerJoin(bookings, and(eq(bookings.slotId, slots.id), eq(bookings.status, 'confirmed')))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(inArray(blockedPeriods.id, blockIds))
    .orderBy(asc(slots.startsAt), asc(bookings.id));
}
