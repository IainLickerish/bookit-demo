import { z } from 'zod';
import { isLocalDate, zonedTimeToUtc } from '@/lib/time';

export interface TimeBlockFields {
  practitionerId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export const TIME_BLOCK_REASON_LIMIT = 240;

const localDateTime = z
  .string()
  .regex(/^(?!00)\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => isLocalDate(value.slice(0, 10)));

const input = z.object({
  practitionerId: z.uuid(),
  startsAt: localDateTime,
  endsAt: localDateTime,
  reason: z.string().trim().max(TIME_BLOCK_REASON_LIMIT),
});

export function parseTimeBlock(fields: TimeBlockFields, timeZone: string) {
  const result = input.safeParse(fields);
  if (!result.success) return { status: 'invalid_fields' } as const;
  const { practitionerId, startsAt, endsAt, reason } = result.data;
  const start = zonedTimeToUtc(startsAt.slice(0, 10), startsAt.slice(11), timeZone, 'unambiguous');
  const end = zonedTimeToUtc(endsAt.slice(0, 10), endsAt.slice(11), timeZone, 'unambiguous');
  if (!start || !end) return { status: 'clock_change' } as const;
  if (end <= start) return { status: 'invalid_range' } as const;
  return { status: 'valid', block: { practitionerId, startsAt: start, endsAt: end, reason: reason || null } } as const;
}
