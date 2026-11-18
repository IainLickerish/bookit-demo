import { and, asc, desc, eq, gt, inArray, lt, lte } from 'drizzle-orm';
import { bookings, practitioners, slots, timeBlocks, users } from '@/db/schema';
import { newId } from '@/lib/ids';
import { isUuid } from '../bookings/queries';
import { findSessionUser } from '../auth/session';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import { lockPractitioner } from '../slots/time-blocks';
import type { AdminReportDependencies } from './http';
import { parseTimeBlock, TimeBlockInputError } from './time-block-input';

async function authorise(deps: AdminReportDependencies, token: string | undefined) {
  const user = token ? await findSessionUser(deps.db, deps.clock, token) : null;
  if (user?.role !== 'admin') throw new Error('Staff sign-in required');
}

export async function createTimeBlock(deps: AdminReportDependencies, token: string | undefined, input: unknown) {
  try {
    await authorise(deps, token);
    const settings = await loadClinicSettings(deps.db);
    const values = parseTimeBlock(input, settings.timeZone);
    const id = newId(deps.clock);
    await deps.db.transaction(async (tx) => {
      if (!(await lockPractitioner(tx, values.practitionerId))) throw new TimeBlockInputError('practitioner');
      await tx.insert(timeBlocks).values({ ...values, id, createdAt: deps.clock.now() });
    });
    deps.log.info({ event: 'admin.time_block_created', block_id: id }, 'Time block saved');
    return id;
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}

export const TIME_BLOCK_PAGE_SIZE = 20;

/** Uses only the current clinic's session and database. No request selects a clinic. */
export async function listTimeBlocks(deps: AdminReportDependencies, token: string | undefined, before?: string) {
  try {
    await authorise(deps, token);
    if (before !== undefined && !isUuid(before)) throw new Error('Invalid time block page');
    const candidates = await deps.db
      .select({
        id: timeBlocks.id,
        practitionerName: practitioners.name,
        startsAt: timeBlocks.startsAt,
        endsAt: timeBlocks.endsAt,
        reason: timeBlocks.reason,
      })
      .from(timeBlocks)
      .innerJoin(practitioners, eq(practitioners.id, timeBlocks.practitionerId))
      // IDs are time-ordered UUIDv7 values. The primary key supports cursor paging.
      .where(before ? lt(timeBlocks.id, before) : undefined)
      .orderBy(desc(timeBlocks.id))
      .limit(TIME_BLOCK_PAGE_SIZE + 1);
    const blocks = candidates.slice(0, TIME_BLOCK_PAGE_SIZE);
    const nextCursor = candidates.length > TIME_BLOCK_PAGE_SIZE ? blocks.at(-1)!.id : undefined;
    if (!blocks.length) return { blocks: [], nextCursor };
    const affected = await deps.db
      .select({
        blockId: timeBlocks.id,
        id: bookings.id,
        patientName: users.name,
        email: users.email,
        phone: bookings.phone,
        practitionerName: practitioners.name,
        startsAt: slots.startsAt,
        endsAt: slots.endsAt,
      })
      .from(timeBlocks)
      .innerJoin(
        slots,
        and(
          eq(slots.practitionerId, timeBlocks.practitionerId),
          lte(slots.startsAt, timeBlocks.endsAt),
          gt(slots.endsAt, timeBlocks.startsAt),
        ),
      )
      .innerJoin(bookings, and(eq(bookings.slotId, slots.id), eq(bookings.status, 'confirmed')))
      .innerJoin(users, eq(users.id, bookings.patientId))
      .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
      .where(
        inArray(
          timeBlocks.id,
          blocks.map((block) => block.id),
        ),
      )
      .orderBy(asc(slots.startsAt), asc(bookings.id));
    const byBlock = new Map<string, typeof affected>();
    for (const booking of affected) {
      const group = byBlock.get(booking.blockId);
      if (group) group.push(booking);
      else byBlock.set(booking.blockId, [booking]);
    }
    return { blocks: blocks.map((block) => ({ ...block, affectedBookings: byBlock.get(block.id) ?? [] })), nextCursor };
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
