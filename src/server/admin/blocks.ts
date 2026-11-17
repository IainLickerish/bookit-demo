import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { bookings, practitionerBlocks, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { formatLocalTime, localDateOf, timeZoneOffsetMs, zonedTimeToUtc } from '@/lib/time';
import { loadClinicSettings } from '../settings';
import { lockPractitioner } from '../slots/blocks';

export const blockInput = z.strictObject({
  practitionerId: z.uuid(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  reason: z.string().trim().max(500),
});
export type BlockInput = z.infer<typeof blockInput>;
export type BlockField = keyof BlockInput;

/** Refuse skipped and repeated wall times rather than silently choosing an instant. */
export function blockInstant(value: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split('T') as [string, string];
  try {
    const instant = zonedTimeToUtc(date, time, timeZone);
    if (!instant) return null;
    const offset = timeZoneOffsetMs(instant.getTime(), timeZone);
    for (const delta of [-86_400_000, 86_400_000]) {
      const alternative = new Date(instant.getTime() + offset - timeZoneOffsetMs(instant.getTime() + delta, timeZone));
      if (
        alternative.getTime() !== instant.getTime() &&
        localDateOf(alternative, timeZone) === date &&
        formatLocalTime(alternative, timeZone) === time
      )
        return null;
    }
    return instant;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export class BlockInputError extends Error {
  constructor(readonly field: BlockField) {
    super('Invalid blocked period');
  }
}

/** The database is selected by this clinic's server, never by form input. */
export async function saveAdminBlock(db: Database, clock: Clock, input: BlockInput): Promise<string> {
  const parsed = blockInput.safeParse(input);
  if (!parsed.success) throw new BlockInputError((parsed.error.issues[0]?.path[0] as BlockField) ?? 'startsAt');
  return db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const startsAt = blockInstant(parsed.data.startsAt, settings.timeZone);
    const endsAt = blockInstant(parsed.data.endsAt, settings.timeZone);
    if (!startsAt) throw new BlockInputError('startsAt');
    if (!endsAt || endsAt <= startsAt) throw new BlockInputError('endsAt');
    if (!(await lockPractitioner(tx, parsed.data.practitionerId))) throw new BlockInputError('practitionerId');
    const id = newId(clock);
    await tx.insert(practitionerBlocks).values({
      id,
      practitionerId: parsed.data.practitionerId,
      startsAt,
      endsAt,
      reason: parsed.data.reason || null,
      createdAt: clock.now(),
    });
    return id;
  });
}

export async function listAffectedBookings(
  db: Executor,
  block: {
    practitionerId: string;
    startsAt: Date;
    endsAt: Date;
  },
) {
  return db
    .select({ id: bookings.id, patientName: users.name, startsAt: slots.startsAt, endsAt: slots.endsAt })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(
      and(
        eq(bookings.status, 'confirmed'),
        eq(slots.practitionerId, block.practitionerId),
        lt(slots.startsAt, block.endsAt),
        gt(slots.endsAt, block.startsAt),
      ),
    )
    .orderBy(asc(slots.startsAt), asc(bookings.id));
}

export async function listAdminBlocks(db: Executor) {
  return db
    .select({
      id: practitionerBlocks.id,
      practitionerId: practitionerBlocks.practitionerId,
      practitionerName: practitioners.name,
      startsAt: practitionerBlocks.startsAt,
      endsAt: practitionerBlocks.endsAt,
      reason: practitionerBlocks.reason,
    })
    .from(practitionerBlocks)
    .innerJoin(practitioners, eq(practitioners.id, practitionerBlocks.practitionerId))
    .orderBy(asc(practitionerBlocks.startsAt), asc(practitionerBlocks.id));
}
