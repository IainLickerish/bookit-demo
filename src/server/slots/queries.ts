import { and, asc, eq, gt, lt, lte, notExists, sql, type SQLWrapper } from 'drizzle-orm';
import type { Executor, Transaction } from '@/db/client';
import { bookings, practitioners, slots, timeBlocks } from '@/db/schema';
import { BookingError } from '../bookings/errors';
import { isUuid } from '../bookings/queries';

export interface SlotView {
  id: string;
  practitionerId: string;
  practitionerName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface PractitionerSummary {
  id: string;
  name: string;
  bio: string;
}

const slotViewColumns = {
  id: slots.id,
  practitionerId: practitioners.id,
  practitionerName: practitioners.name,
  startsAt: slots.startsAt,
  endsAt: slots.endsAt,
};

export async function listActivePractitioners(db: Executor): Promise<PractitionerSummary[]> {
  return db
    .select({ id: practitioners.id, name: practitioners.name, bio: practitioners.bio })
    .from(practitioners)
    .where(eq(practitioners.active, true))
    .orderBy(asc(practitioners.name), asc(practitioners.id));
}

function bookableSlotQuery(db: Executor, slotId: string) {
  return db
    .select(slotViewColumns)
    .from(slots)
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(and(eq(slots.id, slotId), eq(practitioners.active, true)));
}

/** A slot of an active practitioner, whether or not it is booked or blocked. */
export async function findBookableSlot(db: Executor, slotId: string): Promise<SlotView | null> {
  if (!isUuid(slotId)) return null;
  const [row] = await bookableSlotQuery(db, slotId);
  return row ?? null;
}

/** A session touching the start or end of an absence without crossing it can still take place. */
export function slotOverlaps(period: { startsAt: Date | SQLWrapper; endsAt: Date | SQLWrapper }) {
  return and(lt(slots.startsAt, period.endsAt), gt(slots.endsAt, period.startsAt));
}

const noConfirmedBooking = notExists(
  sql`(select 1 from ${bookings} where ${bookings.slotId} = ${slots.id} and ${bookings.status} = 'confirmed')`,
);

const noTimeBlock = notExists(
  sql`(select 1 from ${timeBlocks}
      where ${timeBlocks.practitionerId} = ${slots.practitionerId} and ${slotOverlaps(timeBlocks)})`,
);

/** Lock against a staff time block before checking availability in a fresh query. */
export async function lockUnblockedSlot(tx: Transaction, slotId: string): Promise<SlotView> {
  if (!isUuid(slotId)) throw new BookingError('slot_not_found');
  const [slot] = await bookableSlotQuery(tx, slotId).for('share', { of: practitioners });
  if (!slot) throw new BookingError('slot_not_found');
  const [unblocked] = await tx
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slotId), noTimeBlock));
  if (!unblocked) throw new BookingError('slot_blocked');
  return slot;
}

export async function isSlotFree(db: Executor, slotId: string): Promise<boolean> {
  if (!isUuid(slotId)) {
    return false;
  }
  const [row] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slotId), noConfirmedBooking, noTimeBlock));
  return row !== undefined;
}

export interface AvailableSlotsQuery {
  practitionerId: string;
  /** Slots must start strictly after this instant. */
  after: Date;
  /** Slots must start at or before this instant. */
  until: Date;
}

/** Unbooked, unblocked slots of an active practitioner, earliest first. */
export async function listAvailableSlots(db: Executor, query: AvailableSlotsQuery): Promise<SlotView[]> {
  if (!isUuid(query.practitionerId) || query.until <= query.after) {
    return [];
  }
  return db
    .select(slotViewColumns)
    .from(slots)
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(
      and(
        eq(slots.practitionerId, query.practitionerId),
        eq(practitioners.active, true),
        gt(slots.startsAt, query.after),
        lte(slots.startsAt, query.until),
        noConfirmedBooking,
        noTimeBlock,
      ),
    )
    .orderBy(asc(slots.startsAt));
}
