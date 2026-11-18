import { and, asc, desc, eq, gt, lte } from 'drizzle-orm';
import { bookings, practitioners, slots, timeBlocks, users } from '@/db/schema';
import { newId } from '@/lib/ids';
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

/** Uses only the current clinic's session and database. No request selects a clinic. */
export async function listTimeBlocks(deps: AdminReportDependencies, token: string | undefined) {
  try {
    await authorise(deps, token);
    const blocks = await deps.db
      .select({
        id: timeBlocks.id,
        practitionerName: practitioners.name,
        startsAt: timeBlocks.startsAt,
        endsAt: timeBlocks.endsAt,
        reason: timeBlocks.reason,
      })
      .from(timeBlocks)
      .innerJoin(practitioners, eq(practitioners.id, timeBlocks.practitionerId))
      .orderBy(desc(timeBlocks.createdAt), desc(timeBlocks.id));
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
      .orderBy(asc(slots.startsAt), asc(bookings.id));
    return blocks.map((block) => ({
      ...block,
      affectedBookings: affected.filter((booking) => booking.blockId === block.id),
    }));
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
