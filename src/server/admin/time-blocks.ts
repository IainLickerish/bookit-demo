import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { practitioners, timeBlocks } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { zonedTimeToUtc } from '@/lib/time';
import { isUuid } from '../bookings/queries';
import { loadClinicSettings } from '../settings';
import { listConfirmedBookingsOverlapping } from './bookings';

const localMinute = z.templateLiteral([z.iso.date(), 'T', z.iso.time({ precision: -1 })]);
export const TIME_BLOCK_REASON_LIMIT = 500;

export interface TimeBlockFields {
  practitionerId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export type TimeBlockErrorCode = keyof TimeBlockFields | 'order' | 'clock_change' | 'time_zone_changed';

export async function saveTimeBlock(
  db: Database,
  clock: Clock,
  displayedTimeZone: string,
  fields: Omit<TimeBlockFields, 'reason'> & { reason?: string },
): Promise<{ id: string } | { error: TimeBlockErrorCode; field: keyof TimeBlockFields | null }> {
  if (!isUuid(fields.practitionerId)) return { error: 'practitionerId', field: 'practitionerId' };
  if (!localMinute.safeParse(fields.startsAt).success || fields.startsAt.slice(0, 4) < '0100') {
    return { error: 'startsAt', field: 'startsAt' };
  }
  if (!localMinute.safeParse(fields.endsAt).success || fields.endsAt.slice(0, 4) < '0100') {
    return { error: 'endsAt', field: 'endsAt' };
  }
  const reason = fields.reason?.trim() || null;
  if (reason && reason.length > TIME_BLOCK_REASON_LIMIT) return { error: 'reason', field: 'reason' };

  return db.transaction(async (tx) => {
    // Hold the settings row until the block is stored in the zone staff reviewed.
    const { timeZone } = await loadClinicSettings(tx, 'share');
    if (timeZone !== displayedTimeZone) return { error: 'time_zone_changed', field: null };
    const toInstant = (local: string) =>
      zonedTimeToUtc(local.slice(0, 10), local.slice(11), timeZone, { rejectAmbiguous: true });
    const startsAt = toInstant(fields.startsAt);
    if (!startsAt) return { error: 'clock_change', field: 'startsAt' };
    const endsAt = toInstant(fields.endsAt);
    if (!endsAt) return { error: 'clock_change', field: 'endsAt' };
    if (endsAt <= startsAt) return { error: 'order', field: 'endsAt' };

    // Bookings and moves hold a shared lock on this row while checking and writing.
    const [practitioner] = await tx
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(and(eq(practitioners.id, fields.practitionerId), eq(practitioners.active, true)))
      .for('no key update');
    if (!practitioner) return { error: 'practitionerId', field: 'practitionerId' };

    const id = newId(clock);
    await tx.insert(timeBlocks).values({
      id,
      practitionerId: practitioner.id,
      startsAt,
      endsAt,
      reason,
      createdAt: clock.now(),
    });
    return { id };
  });
}

export async function loadTimeBlock(db: Executor, id: string) {
  if (!isUuid(id)) return null;
  const [block] = await db
    .select({
      id: timeBlocks.id,
      practitionerId: practitioners.id,
      practitionerName: practitioners.name,
      startsAt: timeBlocks.startsAt,
      endsAt: timeBlocks.endsAt,
      reason: timeBlocks.reason,
    })
    .from(timeBlocks)
    .innerJoin(practitioners, eq(practitioners.id, timeBlocks.practitionerId))
    .where(eq(timeBlocks.id, id));
  if (!block) return null;
  const bookings = await listConfirmedBookingsOverlapping(db, block);
  return { ...block, bookings };
}
