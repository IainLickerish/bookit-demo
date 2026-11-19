import { and, asc, eq, gt, lt, lte, notExists, sql, type SQLWrapper } from 'drizzle-orm';
import type { Executor } from '@/db/client';
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

/** Writers take a shared practitioner lock before checking availability in a separate statement. */
export async function findBookableSlot(
  db: Executor,
  slotId: string,
  lockPractitioner = false,
): Promise<SlotView | null> {
  if (!isUuid(slotId)) {
    return null;
  }
  const query = db
    .select(slotViewColumns)
    .from(slots)
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .where(and(eq(slots.id, slotId), eq(practitioners.active, true)));
  const [row] = await (lockPractitioner ? query.for('share', { of: practitioners }) : query);
  return row ?? null;
}

/** A session that ends as the period starts, or starts as it ends, is outside the period. */
export function slotOverlaps(startsAt: Date | SQLWrapper, endsAt: Date | SQLWrapper) {
  return and(lt(slots.startsAt, endsAt), gt(slots.endsAt, startsAt));
}

const noConfirmedBooking = notExists(
  sql`(select 1 from ${bookings} where ${bookings.slotId} = ${slots.id} and ${bookings.status} = 'confirmed')`,
);

const blockingPeriods = sql`(
  select 1 from ${blockedPeriods}
  where ${blockedPeriods.practitionerId} = ${slots.practitionerId}
  and ${slotOverlaps(blockedPeriods.startsAt, blockedPeriods.endsAt)}
)`;

const slotIsFree = and(noConfirmedBooking, notExists(blockingPeriods));

export async function isSlotBlocked(db: Executor, slotId: string): Promise<boolean> {
  const [row] = await db
    .select({ blocked: sql<boolean>`exists ${blockingPeriods}` })
    .from(slots)
    .where(eq(slots.id, slotId));
  return row?.blocked ?? false;
}

export async function isSlotFree(db: Executor, slotId: string): Promise<boolean> {
  if (!isUuid(slotId)) {
    return false;
  }
  const [row] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, slotId), slotIsFree));
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
        slotIsFree,
      ),
    )
    .orderBy(asc(slots.startsAt));
}
