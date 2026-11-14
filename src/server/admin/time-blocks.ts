import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { Database, Executor } from '@/db/client';
import { bookings, practitioners, slots, timeBlocks, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { lockPractitioner } from '../practitioners';
import { loadClinicSettings } from '../settings';
import { parseTimeBlock, TimeBlockInputError, type TimeBlockValues } from './time-block-input';

/** Call only after requireAdmin. The executor is fixed to the signed-in clinic. */
export async function saveTimeBlock(db: Database, clock: Clock, values: TimeBlockValues): Promise<string> {
  return db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const input = parseTimeBlock(values, settings.timeZone);
    if (!(await lockPractitioner(tx, input.practitionerId))) {
      throw new TimeBlockInputError({ practitionerId: 'practitioner' });
    }
    const id = newId(clock);
    await tx.insert(timeBlocks).values({ id, ...input, createdAt: clock.now() });
    return id;
  });
}

/** Include every currently confirmed overlap, including slots starting before a block. */
export async function listTimeBlocks(db: Executor) {
  const [blocks, affected] = await Promise.all([
    db
      .select({
        id: timeBlocks.id,
        practitionerName: practitioners.name,
        startsAt: timeBlocks.startsAt,
        endsAt: timeBlocks.endsAt,
        reason: timeBlocks.reason,
      })
      .from(timeBlocks)
      .innerJoin(practitioners, eq(practitioners.id, timeBlocks.practitionerId))
      .orderBy(asc(timeBlocks.startsAt), asc(timeBlocks.id)),
    db
      .select({
        blockId: timeBlocks.id,
        id: bookings.id,
        patientName: users.name,
        practitionerName: practitioners.name,
        startsAt: slots.startsAt,
        endsAt: slots.endsAt,
      })
      .from(timeBlocks)
      .innerJoin(
        slots,
        and(
          eq(slots.practitionerId, timeBlocks.practitionerId),
          lt(slots.startsAt, timeBlocks.endsAt),
          gt(slots.endsAt, timeBlocks.startsAt),
        ),
      )
      .innerJoin(bookings, and(eq(bookings.slotId, slots.id), eq(bookings.status, 'confirmed')))
      .innerJoin(users, eq(users.id, bookings.patientId))
      .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
      .orderBy(asc(slots.startsAt), asc(bookings.id)),
  ]);
  return blocks.map((block) => ({ ...block, affected: affected.filter((row) => row.blockId === block.id) }));
}
