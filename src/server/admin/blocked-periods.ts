import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { blockedPeriods, practitioners } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { isLocalDate, zonedTimeToUtc } from '@/lib/time';
import { loadClinicSettings } from '../settings';
import { listAdminBookings } from './bookings';

export const BLOCK_REASON_LIMIT = 240;

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => isLocalDate(value.slice(0, 10)));

const blockInput = z.object({
  practitionerId: z.uuid(),
  start: localDateTime,
  end: localDateTime,
  reason: z.string().trim().max(BLOCK_REASON_LIMIT).optional(),
});

export interface BlockFields {
  practitionerId: string;
  start: string;
  end: string;
  reason: string;
}

export type BlockError = 'invalid_practitioner' | 'invalid_start' | 'invalid_end' | 'invalid_reason' | 'invalid_order';

export function parseBlockPeriod(input: unknown, timeZone: string) {
  const parsed = blockInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error = field === 'start' || field === 'end' || field === 'reason' ? field : 'practitioner';
    return { error: `invalid_${error}` as const };
  }
  const { practitionerId, start, end, reason } = parsed.data;
  const startsAt = zonedTimeToUtc(start.slice(0, 10), start.slice(11), timeZone);
  if (!startsAt) return { error: 'invalid_start' as const };
  const endsAt = zonedTimeToUtc(end.slice(0, 10), end.slice(11), timeZone);
  if (!endsAt) return { error: 'invalid_end' as const };
  if (endsAt <= startsAt) return { error: 'invalid_order' as const };
  return { period: { practitionerId, startsAt, endsAt, reason: reason || null } };
}

type Period = NonNullable<ReturnType<typeof parseBlockPeriod>['period']>;

async function describeBlock(db: Executor, period: Period, practitionerName: string, timeZone: string, id: string) {
  const rows = await listAdminBookings(
    db,
    { practitionerId: period.practitionerId, status: 'confirmed' },
    timeZone,
    period,
  );
  const affected = rows.map(({ id, patientName, startsAt, endsAt }) => ({ id, patientName, startsAt, endsAt }));
  const details = { ...period, practitionerName, timeZone, affected, id };
  const version = createHash('sha256').update(JSON.stringify(details)).digest('hex');
  return { ...details, version };
}

export type BlockReview = Awaited<ReturnType<typeof describeBlock>>;

async function evaluateBlock(db: Executor, input: unknown) {
  const { timeZone } = await loadClinicSettings(db);
  return { ...parseBlockPeriod(input, timeZone), timeZone };
}

export async function reviewPractitionerBlock(db: Executor, clock: Clock, input: unknown) {
  const { error, period, timeZone } = await evaluateBlock(db, input);
  if (error) return { error };
  const [person] = await db
    .select({ name: practitioners.name })
    .from(practitioners)
    .where(eq(practitioners.id, period.practitionerId));
  if (!person) return { error: 'invalid_practitioner' as const };
  return { review: await describeBlock(db, period, person.name, timeZone, newId(clock)) };
}

export async function savePractitionerBlock(
  db: Database,
  clock: Clock,
  input: unknown,
  previous: Pick<BlockReview, 'id' | 'version'>,
) {
  const id = z.uuid().safeParse(previous.id);
  if (!id.success) return { error: 'invalid_practitioner' as const };
  return db.transaction(async (tx) => {
    const { error, period, timeZone } = await evaluateBlock(tx, input);
    if (error) return { error };

    // Bookings and moves take a shared lock on this practitioner. The review
    // check and the insert must see every booking made before we get this lock.
    const [person] = await tx
      .select({ name: practitioners.name })
      .from(practitioners)
      .where(eq(practitioners.id, period.practitionerId))
      .for('no key update');
    if (!person) return { error: 'invalid_practitioner' as const };

    const review = await describeBlock(tx, period, person.name, timeZone, id.data);
    if (review.version !== previous.version) return { review, saved: false as const };

    const [inserted] = await tx
      .insert(blockedPeriods)
      .values({ ...period, id: id.data, createdAt: clock.now() })
      .onConflictDoNothing({ target: blockedPeriods.id })
      .returning({ id: blockedPeriods.id });
    if (!inserted) {
      const [existing] = await tx.select().from(blockedPeriods).where(eq(blockedPeriods.id, id.data));
      if (
        existing?.practitionerId !== period.practitionerId ||
        existing.startsAt.getTime() !== period.startsAt.getTime() ||
        existing.endsAt.getTime() !== period.endsAt.getTime() ||
        existing.reason !== period.reason
      ) {
        return { review: await describeBlock(tx, period, person.name, timeZone, newId(clock)), saved: false as const };
      }
    }
    return { review, saved: true as const };
  });
}
