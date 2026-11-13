import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { blockedCancellations, blockedPeriods, bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { isLocalDate, zonedTimeToUtc } from '@/lib/time';
import { lockDiary } from '@/server/bookings/diary-lock';
import { loadClinicSettings } from '@/server/settings';

export class BlockedTimeError extends Error {
  constructor(readonly code: 'invalid' | 'changed' | 'not_staff') {
    super(code);
  }
}

export const blockedTimeInput = z.strictObject({
  practitionerId: z.uuid(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  reason: z.string().trim().max(300),
});
export type BlockedTimeInput = z.infer<typeof blockedTimeInput>;

/** Reject skipped and repeated wall times rather than silently choosing a clock-change offset. */
export function blockInstant(value: string, timeZone: string): Date | null {
  const [date, time] = value.split('T');
  if (!date || !time || !isLocalDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const instant = zonedTimeToUtc(date, time, timeZone);
  if (!instant) return null;
  // A repeated wall time has another matching instant within the clock-change window.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wall = format.format(instant);
  for (let minutes = 1; minutes <= 180; minutes++) {
    if (format.format(new Date(instant.getTime() + minutes * 60_000)) === wall) return null;
  }
  return instant;
}

async function assertStaff(db: Executor, staffId: string) {
  if (!z.uuid().safeParse(staffId).success) throw new BlockedTimeError('not_staff');
  const [staff] = await db.select({ role: users.role }).from(users).where(eq(users.id, staffId));
  if (staff?.role !== 'admin') throw new BlockedTimeError('not_staff');
}

async function affectedBookings(db: Executor, practitionerId: string, startsAt: Date, endsAt: Date) {
  return db
    .select({
      id: bookings.id,
      slotId: slots.id,
      patientName: users.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
      updatedAt: bookings.updatedAt,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(
      and(
        eq(slots.practitionerId, practitionerId),
        eq(bookings.status, 'confirmed'),
        lt(slots.startsAt, endsAt),
        gt(slots.endsAt, startsAt),
      ),
    )
    .orderBy(asc(bookings.id));
}

async function review(db: Executor, clock: Clock, input: unknown) {
  const parsed = blockedTimeInput.safeParse(input);
  if (!parsed.success) throw new BlockedTimeError('invalid');
  const values = parsed.data;
  const settings = await loadClinicSettings(db);
  const startsAt = blockInstant(values.start, settings.timeZone);
  const endsAt = blockInstant(values.end, settings.timeZone);
  if (!startsAt || !endsAt || startsAt <= clock.now() || endsAt <= startsAt) throw new BlockedTimeError('invalid');
  const [practitioner] = await db
    .select({ name: practitioners.name })
    .from(practitioners)
    .where(eq(practitioners.id, values.practitionerId));
  if (!practitioner) throw new BlockedTimeError('invalid');
  const affected = await affectedBookings(db, values.practitionerId, startsAt, endsAt);
  const snapshot = createHash('sha256')
    .update(JSON.stringify({ values, timeZone: settings.timeZone, affected }))
    .digest('hex');
  return {
    values,
    startsAt,
    endsAt,
    practitionerName: practitioner.name,
    timeZone: settings.timeZone,
    affected,
    snapshot,
  };
}

export async function reviewBlockedTime(db: Executor, clock: Clock, staffId: string, input: unknown) {
  await assertStaff(db, staffId);
  return review(db, clock, input);
}

export async function confirmBlockedTime(
  db: Database,
  clock: Clock,
  staffId: string,
  input: unknown,
  blockId: string,
  snapshot: string,
): Promise<string> {
  await assertStaff(db, staffId);
  if (!z.uuid().safeParse(blockId).success || !/^[a-f0-9]{64}$/.test(snapshot)) throw new BlockedTimeError('invalid');
  return db.transaction(async (tx) => {
    await lockDiary(tx);
    // Repeated confirmation of this review returns the already saved result.
    const [existing] = await tx.select().from(blockedPeriods).where(eq(blockedPeriods.id, blockId));
    if (existing) {
      if (existing.createdBy !== staffId) throw new BlockedTimeError('invalid');
      return existing.id;
    }
    const checked = await review(tx, clock, input);
    if (checked.snapshot !== snapshot) throw new BlockedTimeError('changed');
    const now = clock.now();
    await tx.insert(blockedPeriods).values({
      id: blockId,
      practitionerId: checked.values.practitionerId,
      startsAt: checked.startsAt,
      endsAt: checked.endsAt,
      reason: checked.values.reason || null,
      createdBy: staffId,
      createdAt: now,
    });
    const ids = checked.affected.map((booking) => booking.id);
    if (ids.length) {
      await tx
        .update(bookings)
        .set({ status: 'cancelled', cancelledAt: now, updatedAt: now, lateCancellation: false })
        .where(inArray(bookings.id, ids));
      await tx.insert(blockedCancellations).values(ids.map((bookingId) => ({ bookingId, blockId })));
    }
    return blockId;
  });
}

export const BLOCKED_TIME_PAGE_SIZE = 20;
export const BLOCK_CANCELLATIONS_PAGE_SIZE = 20;
const blockDetails = {
  id: blockedPeriods.id,
  practitionerName: practitioners.name,
  startsAt: blockedPeriods.startsAt,
  endsAt: blockedPeriods.endsAt,
  reason: blockedPeriods.reason,
};

/** This executor belongs to the current clinic; callers cannot select another tenant. */
export async function listBlockedTime(db: Executor, staffId: string, before?: string) {
  await assertStaff(db, staffId);
  const [cursor] = z.uuid().safeParse(before).success
    ? await db.select().from(blockedPeriods).where(eq(blockedPeriods.id, before!))
    : [];
  const rows = await db
    .select(blockDetails)
    .from(blockedPeriods)
    .innerJoin(practitioners, eq(practitioners.id, blockedPeriods.practitionerId))
    .where(
      cursor
        ? sql`(${blockedPeriods.createdAt}, ${blockedPeriods.id}) < (${cursor.createdAt}, ${cursor.id})`
        : undefined,
    )
    .orderBy(desc(blockedPeriods.createdAt), desc(blockedPeriods.id))
    .limit(BLOCKED_TIME_PAGE_SIZE + 1);
  const blocks = rows.slice(0, BLOCKED_TIME_PAGE_SIZE);
  return {
    blocks,
    nextCursor: rows.length > BLOCKED_TIME_PAGE_SIZE ? blocks.at(-1)!.id : null,
  };
}

/** Reopening a saved block does not depend on the page of history currently shown. */
export async function getBlockedTime(db: Executor, staffId: string, blockId: string | undefined) {
  await assertStaff(db, staffId);
  if (!z.uuid().safeParse(blockId).success) return null;
  const [block] = await db
    .select(blockDetails)
    .from(blockedPeriods)
    .innerJoin(practitioners, eq(practitioners.id, blockedPeriods.practitionerId))
    .where(eq(blockedPeriods.id, blockId!));
  return block ?? null;
}

export async function listBlockCancellations(db: Executor, staffId: string, blockId: string, after?: string) {
  await assertStaff(db, staffId);
  if (!z.uuid().safeParse(blockId).success) return { cancellations: [], nextCursor: null };
  // A cursor is valid only within this block in the current clinic.
  const [cursor] = z.uuid().safeParse(after).success
    ? await db
        .select({ id: blockedCancellations.bookingId, startsAt: slots.startsAt })
        .from(blockedCancellations)
        .innerJoin(bookings, eq(bookings.id, blockedCancellations.bookingId))
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .where(and(eq(blockedCancellations.blockId, blockId), eq(blockedCancellations.bookingId, after!)))
    : [];
  const rows = await db
    .select({ id: bookings.id, patientName: users.name, startsAt: slots.startsAt, endsAt: slots.endsAt })
    .from(blockedCancellations)
    .innerJoin(bookings, eq(bookings.id, blockedCancellations.bookingId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(blockedCancellations.blockId, blockId),
        cursor ? sql`(${slots.startsAt}, ${bookings.id}) > (${cursor.startsAt}, ${cursor.id})` : undefined,
      ),
    )
    .orderBy(asc(slots.startsAt), asc(bookings.id))
    .limit(BLOCK_CANCELLATIONS_PAGE_SIZE + 1);
  const cancellations = rows.slice(0, BLOCK_CANCELLATIONS_PAGE_SIZE);
  return {
    cancellations,
    nextCursor: rows.length > BLOCK_CANCELLATIONS_PAGE_SIZE ? cancellations.at(-1)!.id : null,
  };
}
