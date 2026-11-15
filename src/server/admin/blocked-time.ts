import { and, asc, desc, eq, gt, inArray, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { BLOCK_FIELD_ERRORS } from '@/app/messages';
import type { Database, Executor } from '@/db/client';
import { bookings, practitionerBlocks, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { zonedTimeToUtc } from '@/lib/time';
import { loadClinicSettings } from '../settings';
import { isUuid } from '../bookings/queries';
import { lockPractitioner } from '../slots/blocked';

export const blockInput = z.strictObject({
  practitionerId: z.uuid(),
  start: z.string(),
  end: z.string(),
  reason: z.string().trim().max(500),
});
export type BlockInput = z.infer<typeof blockInput>;
export type BlockField = keyof BlockInput;
export type BlockErrors = Partial<Record<BlockField, string>>;
export class InvalidBlockError extends Error {
  constructor(readonly fields: BlockErrors) {
    super('Invalid blocked period');
  }
}

function localInstant(value: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  try {
    return zonedTimeToUtc(value.slice(0, 10), value.slice(11), timeZone);
  } catch {
    return null;
  }
}

/** Uses the existing clinic conversion, including the first occurrence of repeated times. */
export function parseBlockedPeriod(input: unknown, timeZone: string) {
  const parsed = blockInput.safeParse(input);
  if (!parsed.success) {
    const fields: BlockErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as BlockField;
      fields[field] =
        field === 'practitionerId'
          ? BLOCK_FIELD_ERRORS.practitionerId
          : field === 'reason'
            ? BLOCK_FIELD_ERRORS.reason
            : BLOCK_FIELD_ERRORS.dateTime;
    }
    throw new InvalidBlockError(fields);
  }
  const startsAt = localInstant(parsed.data.start, timeZone);
  const endsAt = localInstant(parsed.data.end, timeZone);
  const fields: BlockErrors = {};
  if (!startsAt) fields.start = BLOCK_FIELD_ERRORS.start;
  if (!endsAt) fields.end = BLOCK_FIELD_ERRORS.end;
  if (startsAt && endsAt && endsAt <= startsAt) fields.end = BLOCK_FIELD_ERRORS.endBeforeStart;
  if (!startsAt || !endsAt || Object.keys(fields).length) throw new InvalidBlockError(fields);
  return { practitionerId: parsed.data.practitionerId, startsAt, endsAt, reason: parsed.data.reason || null };
}

/** Called only after the action's server-side staff check; uses this clinic's database. */
export async function saveBlockedPeriod(db: Database, clock: Clock, input: unknown): Promise<string> {
  return db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const values = parseBlockedPeriod(input, settings.timeZone);
    if (!(await lockPractitioner(tx, values.practitionerId))) {
      throw new InvalidBlockError({ practitionerId: BLOCK_FIELD_ERRORS.practitionerId });
    }
    const id = newId(clock);
    await tx.insert(practitionerBlocks).values({ ...values, id, createdAt: clock.now() });
    return id;
  });
}

export const BLOCKED_PERIODS_PAGE_SIZE = 20;

/** Page by UUIDv7 creation order using the primary index, even when creation times tie.
 * Every confirmed overlap is returned for the displayed periods, without a booking limit.
 */
export async function listBlockedPeriods(db: Executor, query: { beforeId?: string; fromId?: string } = {}) {
  const fromId = query.fromId ?? '';
  const beforeId = query.beforeId ?? '';
  const anchor = isUuid(fromId) ? fromId : isUuid(beforeId) ? beforeId : null;
  const rows = await db
    .select({
      id: practitionerBlocks.id,
      practitionerName: practitioners.name,
      startsAt: practitionerBlocks.startsAt,
      endsAt: practitionerBlocks.endsAt,
      reason: practitionerBlocks.reason,
    })
    .from(practitionerBlocks)
    .innerJoin(practitioners, eq(practitioners.id, practitionerBlocks.practitionerId))
    .where(
      anchor ? (anchor === fromId ? lte(practitionerBlocks.id, anchor) : lt(practitionerBlocks.id, anchor)) : undefined,
    )
    .orderBy(desc(practitionerBlocks.id))
    .limit(BLOCKED_PERIODS_PAGE_SIZE + 1);
  const periods = rows.slice(0, BLOCKED_PERIODS_PAGE_SIZE);
  const olderCursor = rows.length > BLOCKED_PERIODS_PAGE_SIZE ? periods.at(-1)!.id : null;
  if (periods.length === 0) return { periods: [], olderCursor, isLatest: anchor === null };
  const affected = await db
    .select({
      blockId: practitionerBlocks.id,
      bookingId: bookings.id,
      patientName: users.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
    })
    .from(practitionerBlocks)
    .innerJoin(
      slots,
      and(
        eq(slots.practitionerId, practitionerBlocks.practitionerId),
        lt(slots.startsAt, practitionerBlocks.endsAt),
        gt(slots.endsAt, practitionerBlocks.startsAt),
      ),
    )
    .innerJoin(bookings, and(eq(bookings.slotId, slots.id), eq(bookings.status, 'confirmed')))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(
      inArray(
        practitionerBlocks.id,
        periods.map((period) => period.id),
      ),
    )
    .orderBy(asc(slots.startsAt), asc(bookings.id));
  const byPeriod = new Map<string, typeof affected>();
  for (const booking of affected) {
    const group = byPeriod.get(booking.blockId);
    if (group) group.push(booking);
    else byPeriod.set(booking.blockId, [booking]);
  }
  return {
    periods: periods.map((period) => ({ ...period, bookings: byPeriod.get(period.id) ?? [] })),
    olderCursor,
    isLatest: anchor === null,
  };
}
