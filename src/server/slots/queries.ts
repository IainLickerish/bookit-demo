import { and, asc, eq, gt, lt, lte, notExists, sql } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { bookings, practitioners, practitionerTimeOff, slots } from '@/db/schema';
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

/** The slot does not overlap any time off of its practitioner. */
export const notInTimeOff = notExists(
  sql`(select 1 from ${practitionerTimeOff} where ${practitionerTimeOff.practitionerId} = ${slots.practitionerId} and ${practitionerTimeOff.startsAt} < ${slots.endsAt} and ${practitionerTimeOff.endsAt} > ${slots.startsAt})`,
);

/**
 * Whether the slot overlaps its practitioner's time off. Inside a transaction,
 * the practitioner row is locked for share first, so a booking cannot slip in
 * while staff are recording time off that covers it (see createTimeOff).
 */
export async function isSlotInTimeOff(db: Executor, slot: SlotView): Promise<boolean> {
  await db
    .select({ id: practitioners.id })
    .from(practitioners)
    .where(eq(practitioners.id, slot.practitionerId))
    .for('share');
  const [row] = await db
    .select({ id: practitionerTimeOff.id })
    .from(practitionerTimeOff)
    .where(
      and(
        eq(practitionerTimeOff.practitionerId, slot.practitionerId),
        lt(practitionerTimeOff.startsAt, slot.endsAt),
        gt(practitionerTimeOff.endsAt, slot.startsAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Neither booked nor in the practitioner's time off. */
export async function isSlotFree(db: Executor, slotId: string): Promise<boolean> {
  if (!isUuid(slotId)) {
    return false;
  }
  const [row] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slotId), noConfirmedBooking, notInTimeOff));
  return row !== undefined;
}

export interface AvailableSlotsQuery {
  practitionerId: string;
  /** Slots must start strictly after this instant. */
  after: Date;
  /** Slots must start at or before this instant. */
  until: Date;
}

/** Unbooked slots of an active practitioner outside their time off, earliest first. */
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
        notInTimeOff,
      ),
    )
    .orderBy(asc(slots.startsAt));
}
