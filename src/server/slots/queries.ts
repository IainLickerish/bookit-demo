import { and, asc, eq, gt, lte, notExists, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '@/db/client';
import { blockedPeriods, bookings, practitioners, slots } from '@/db/schema';
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

// Booking, moving and blocking time use the same practitioner lock. The check
// after taking the lock sees any block committed while this transaction waited.
export async function lockSlotPractitioner(tx: Transaction, slotId: string): Promise<void> {
  if (!isUuid(slotId)) return;
  await tx
    .select({ id: practitioners.id })
    .from(practitioners)
    .innerJoin(slots, eq(slots.practitionerId, practitioners.id))
    .where(eq(slots.id, slotId))
    .for('update', { of: practitioners });
}

const noBlockedPeriod = notExists(
  sql`(select 1 from ${blockedPeriods} where ${blockedPeriods.practitionerId} = ${slots.practitionerId}
    and ${blockedPeriods.startsAt} < ${slots.endsAt} and ${blockedPeriods.endsAt} > ${slots.startsAt})`,
);

/** A slot of an active practitioner outside blocked time, whether or not booked. */
export async function findBookableSlot(db: Executor, slotId: string): Promise<SlotView | null> {
  if (!isUuid(slotId)) {
    return null;
  }
  const [row] = await db
    .select(slotViewColumns)
    .from(slots)
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(and(eq(slots.id, slotId), eq(practitioners.active, true), noBlockedPeriod));
  return row ?? null;
}

const noConfirmedBooking = notExists(
  sql`(select 1 from ${bookings} where ${bookings.slotId} = ${slots.id} and ${bookings.status} = 'confirmed')`,
);

export async function isSlotFree(db: Executor, slotId: string): Promise<boolean> {
  if (!isUuid(slotId)) {
    return false;
  }
  const [row] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slotId), noConfirmedBooking, noBlockedPeriod));
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
        noBlockedPeriod,
      ),
    )
    .orderBy(asc(slots.startsAt));
}
