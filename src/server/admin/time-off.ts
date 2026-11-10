import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { bookings, practitioners, practitionerTimeOff, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { isUuid } from '../bookings/queries';
import { loadClinicSettings } from '../settings';
import { zonedTimeToUtc } from '@/lib/time';

/** The longest single period of time off staff can enter at once. */
export const MAX_TIME_OFF_DAYS = 366;
export const MAX_REASON_LENGTH = 200;

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** What the admin form sends: local 'YYYY-MM-DDTHH:MM' times in the clinic's zone. */
export const timeOffFormInput = z.strictObject({
  practitionerId: z.uuid(),
  start: z.string().regex(LOCAL_DATE_TIME),
  end: z.string().regex(LOCAL_DATE_TIME),
  reason: z
    .string()
    .trim()
    .max(MAX_REASON_LENGTH)
    .transform((value) => (value === '' ? null : value)),
});
export type TimeOffFormInput = z.input<typeof timeOffFormInput>;

export type TimeOffInputError = 'invalid' | 'end_before_start' | 'already_over' | 'too_long' | 'unknown_practitioner';

export class TimeOffInputRejected extends Error {
  override readonly name = 'TimeOffInputRejected';
  constructor(readonly code: TimeOffInputError) {
    super(`Time off rejected: ${code}`);
  }
}

export interface TimeOffPeriod {
  practitionerId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

/**
 * Turns the form's clinic-local times into instants. A local time skipped by a
 * clock change, an end not after the start, a period that is already over, or
 * one longer than MAX_TIME_OFF_DAYS is refused.
 */
export function parseTimeOffInput(input: unknown, timeZone: string, now: Date): TimeOffPeriod {
  const parsed = timeOffFormInput.safeParse(input);
  if (!parsed.success) throw new TimeOffInputRejected('invalid');
  const toInstant = (value: string) => {
    const [date = '', time = ''] = value.split('T');
    try {
      return zonedTimeToUtc(date, time, timeZone);
    } catch {
      return null;
    }
  };
  const startsAt = toInstant(parsed.data.start);
  const endsAt = toInstant(parsed.data.end);
  if (!startsAt || !endsAt) throw new TimeOffInputRejected('invalid');
  if (endsAt <= startsAt) throw new TimeOffInputRejected('end_before_start');
  if (endsAt <= now) throw new TimeOffInputRejected('already_over');
  if (endsAt.getTime() - startsAt.getTime() > MAX_TIME_OFF_DAYS * 24 * 60 * 60 * 1000) {
    throw new TimeOffInputRejected('too_long');
  }
  return { practitionerId: parsed.data.practitionerId, startsAt, endsAt, reason: parsed.data.reason };
}

export interface AffectedBooking {
  bookingId: string;
  patientName: string;
  patientEmail: string;
  phone: string | null;
  startsAt: Date;
}

/** Confirmed bookings with the practitioner that overlap the period, earliest first. */
export async function listBookingsInPeriod(
  db: Executor,
  period: Pick<TimeOffPeriod, 'practitionerId' | 'startsAt' | 'endsAt'>,
): Promise<AffectedBooking[]> {
  return db
    .select({
      bookingId: bookings.id,
      patientName: users.name,
      patientEmail: users.email,
      phone: bookings.phone,
      startsAt: slots.startsAt,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(
      and(
        eq(slots.practitionerId, period.practitionerId),
        eq(bookings.status, 'confirmed'),
        lt(slots.startsAt, period.endsAt),
        gt(slots.endsAt, period.startsAt),
      ),
    )
    .orderBy(asc(slots.startsAt), asc(bookings.id));
}

export interface CreatedTimeOff {
  id: string;
  affectedBookings: AffectedBooking[];
}

/**
 * Records time off and returns the confirmed bookings inside it. Those
 * bookings are not changed. The practitioner row is locked for update, so a
 * booking made at the same moment either commits first and is listed here, or
 * waits and is then refused because its slot is in the time off.
 */
export async function createTimeOff(
  db: Database,
  clock: Clock,
  createdBy: string,
  input: unknown,
): Promise<CreatedTimeOff> {
  return db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const now = clock.now();
    const period = parseTimeOffInput(input, settings.timeZone, now);
    const [practitioner] = await tx
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(eq(practitioners.id, period.practitionerId))
      .for('update');
    if (!practitioner) throw new TimeOffInputRejected('unknown_practitioner');
    const id = newId(clock);
    await tx.insert(practitionerTimeOff).values({ id, ...period, createdBy, createdAt: now });
    return { id, affectedBookings: await listBookingsInPeriod(tx, period) };
  });
}

export interface TimeOffView extends TimeOffPeriod {
  id: string;
  practitionerName: string;
  affectedBookings: AffectedBooking[];
}

/** Time off that has not ended yet, soonest first, each with the bookings inside it. */
export async function listCurrentTimeOff(db: Executor, now: Date): Promise<TimeOffView[]> {
  const rows = await db
    .select({
      id: practitionerTimeOff.id,
      practitionerId: practitionerTimeOff.practitionerId,
      practitionerName: practitioners.name,
      startsAt: practitionerTimeOff.startsAt,
      endsAt: practitionerTimeOff.endsAt,
      reason: practitionerTimeOff.reason,
    })
    .from(practitionerTimeOff)
    .innerJoin(practitioners, eq(practitioners.id, practitionerTimeOff.practitionerId))
    .where(gt(practitionerTimeOff.endsAt, now))
    .orderBy(asc(practitionerTimeOff.startsAt), asc(practitionerTimeOff.id));
  return Promise.all(rows.map(async (row) => ({ ...row, affectedBookings: await listBookingsInPeriod(db, row) })));
}

/** Removes time off, so its slots are offered again. Returns whether it existed. */
export async function deleteTimeOff(db: Executor, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(practitionerTimeOff)
    .where(eq(practitionerTimeOff.id, id))
    .returning({ id: practitionerTimeOff.id });
  return deleted.length === 1;
}
