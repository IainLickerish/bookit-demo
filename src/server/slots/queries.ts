import { and, asc, eq, gt, lt, lte, notExists, sql, type SQLWrapper } from 'drizzle-orm';
import type { Executor, Transaction } from '@/db/client';
import { blockOuts, bookings, practitioners, slots } from '@/db/schema';
import { BookingError } from '../bookings/errors';
import { isUuid } from '../bookings/queries';
import { lockPractitionerSchedule } from '../practitioners';

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

/** A slot of an active practitioner, whether or not it is booked. */
export async function findBookableSlot(db: Executor, slotId: string): Promise<SlotView | null> {
  if (!isUuid(slotId)) {
    return null;
  }
  const [row] = await db
    .select(slotViewColumns)
    .from(slots)
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(and(eq(slots.id, slotId), eq(practitioners.active, true)));
  return row ?? null;
}

const noConfirmedBooking = notExists(
  sql`(select 1 from ${bookings} where ${bookings.slotId} = ${slots.id} and ${bookings.status} = 'confirmed')`,
);

/** Intervals that only touch at their ends do not overlap. */
export function slotOverlaps(startsAt: Date | SQLWrapper, endsAt: Date | SQLWrapper) {
  return and(lt(slots.startsAt, endsAt), gt(slots.endsAt, startsAt));
}

const noBlockOut = notExists(
  sql`(select 1 from ${blockOuts} where ${blockOuts.practitionerId} = ${slots.practitionerId}
       and ${slotOverlaps(blockOuts.startsAt, blockOuts.endsAt)})`,
);

export async function assertSlotNotBlocked(tx: Transaction, slot: SlotView): Promise<void> {
  const practitioner = await lockPractitionerSchedule(tx, slot.practitionerId, 'share');
  if (!practitioner) throw new BookingError('slot_not_found');
  // Read in a separate statement so a block-out committed while waiting for the lock is visible.
  const [available] = await tx
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slot.id), noBlockOut));
  if (!available) throw new BookingError('slot_blocked');
}

export async function isSlotFree(db: Executor, slotId: string): Promise<boolean> {
  if (!isUuid(slotId)) {
    return false;
  }
  const [row] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slotId), noConfirmedBooking, noBlockOut));
  return row !== undefined;
}

export interface AvailableSlotsQuery {
  practitionerId: string;
  /** Slots must start strictly after this instant. */
  after: Date;
  /** Slots must start at or before this instant. */
  until: Date;
}

/** Unbooked slots of an active practitioner, earliest first. */
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
        noBlockOut,
      ),
    )
    .orderBy(asc(slots.startsAt));
}
