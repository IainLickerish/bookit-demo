import { z } from 'zod';
import type { Database } from '@/db/client';
import { blockOuts } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { isLocalDate, zonedTimeToUtc } from '@/lib/time';
import { lockPractitionerSchedule } from '../practitioners';
import { loadClinicSettings } from '../settings';
import { listAdminBookings, type AdminBooking } from './bookings';

export const BLOCK_OUT_REASON_LIMIT = 500;

const practitionerIdInput = z.uuid();
const reasonInput = z.string().trim().max(BLOCK_OUT_REASON_LIMIT).optional();
const localDateTimeInput = z
  .string()
  .length(16)
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => isLocalDate(value.slice(0, 10)));

function parseLocalDateTime(input: unknown, timeZone: string): Date | null {
  const parsed = localDateTimeInput.safeParse(input);
  if (!parsed.success) return null;
  return zonedTimeToUtc(parsed.data.slice(0, 10), parsed.data.slice(11), timeZone);
}

export type BlockOutErrorCode =
  'invalid_practitioner' | 'invalid_start' | 'invalid_end' | 'invalid_range' | 'invalid_reason';

export interface SavedBlockOut {
  id: string;
  practitionerName: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  timeZone: string;
  conflicts: Pick<AdminBooking, 'id' | 'patientName' | 'startsAt' | 'endsAt'>[];
}

interface BlockOutInput {
  practitionerId: unknown;
  startsAt: unknown;
  endsAt: unknown;
  reason?: unknown;
}

/** Called by the staff-only action. Save the period and read the affected bookings together. */
export async function saveBlockOut(
  db: Database,
  clock: Clock,
  input: BlockOutInput,
): Promise<{ saved: SavedBlockOut } | { error: BlockOutErrorCode }> {
  const practitionerId = practitionerIdInput.safeParse(input.practitionerId);
  if (!practitionerId.success) return { error: 'invalid_practitioner' };
  const reasonInputResult = reasonInput.safeParse(input.reason);
  if (!reasonInputResult.success) return { error: 'invalid_reason' };
  const { timeZone } = await loadClinicSettings(db);
  const startsAt = parseLocalDateTime(input.startsAt, timeZone);
  if (!startsAt) return { error: 'invalid_start' };
  const endsAt = parseLocalDateTime(input.endsAt, timeZone);
  if (!endsAt) return { error: 'invalid_end' };
  if (endsAt <= startsAt) return { error: 'invalid_range' };

  const id = newId(clock);
  const reason = reasonInputResult.data || null;
  return db.transaction(async (tx) => {
    const practitioner = await lockPractitionerSchedule(tx, practitionerId.data, 'no key update');
    if (!practitioner) return { error: 'invalid_practitioner' };
    await tx
      .insert(blockOuts)
      .values({ id, practitionerId: practitioner.id, startsAt, endsAt, reason, createdAt: clock.now() });
    const rows = await listAdminBookings(tx, { practitionerId: practitioner.id, status: 'confirmed' }, timeZone, {
      startsAt,
      endsAt,
    });
    const conflicts = rows.map(({ id, patientName, startsAt, endsAt }) => ({ id, patientName, startsAt, endsAt }));
    return { saved: { id, practitionerName: practitioner.name, startsAt, endsAt, reason, timeZone, conflicts } };
  });
}
