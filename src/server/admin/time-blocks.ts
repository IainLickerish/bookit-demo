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

/** Read blocks and their confirmed overlaps in one snapshot, including empty blocks. */
export async function listTimeBlocks(db: Executor) {
  const confirmed = db.$with('confirmed_block_bookings').as(
    db
      .select({
        id: bookings.id,
        patientName: users.name,
        practitionerId: slots.practitionerId,
        startsAt: slots.startsAt,
        endsAt: slots.endsAt,
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(users, eq(users.id, bookings.patientId))
      .where(eq(bookings.status, 'confirmed')),
  );
  const rows = await db
    .with(confirmed)
    .select({
      id: timeBlocks.id,
      practitionerName: practitioners.name,
      startsAt: timeBlocks.startsAt,
      endsAt: timeBlocks.endsAt,
      reason: timeBlocks.reason,
      bookingId: confirmed.id,
      patientName: confirmed.patientName,
      bookingStart: confirmed.startsAt,
      bookingEnd: confirmed.endsAt,
    })
    .from(timeBlocks)
    .innerJoin(practitioners, eq(practitioners.id, timeBlocks.practitionerId))
    .leftJoin(
      confirmed,
      and(
        eq(confirmed.practitionerId, timeBlocks.practitionerId),
        lt(confirmed.startsAt, timeBlocks.endsAt),
        gt(confirmed.endsAt, timeBlocks.startsAt),
      ),
    )
    .orderBy(asc(timeBlocks.startsAt), asc(timeBlocks.id), asc(confirmed.startsAt), asc(confirmed.id));

  type AffectedBooking = { id: string; patientName: string; practitionerName: string; startsAt: Date; endsAt: Date };
  type Block = Pick<(typeof rows)[number], 'id' | 'practitionerName' | 'startsAt' | 'endsAt' | 'reason'> & {
    affected: AffectedBooking[];
  };
  const blocks = new Map<string, Block>();
  for (const row of rows) {
    let block = blocks.get(row.id);
    if (!block) {
      block = {
        id: row.id,
        practitionerName: row.practitionerName,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        reason: row.reason,
        affected: [],
      };
      blocks.set(row.id, block);
    }
    if (row.bookingId && row.patientName !== null && row.bookingStart && row.bookingEnd) {
      block.affected.push({
        id: row.bookingId,
        patientName: row.patientName,
        practitionerName: row.practitionerName,
        startsAt: row.bookingStart,
        endsAt: row.bookingEnd,
      });
    }
  }
  return [...blocks.values()];
}
