import { z } from 'zod';
import { formatLocalTime, localDateOf, timeZoneOffsetMs, zonedTimeToUtc } from '@/lib/time';

export const TIME_BLOCK_ERRORS = {
  practitioner: 'Choose a practitioner from this clinic.',
  start:
    'Enter a valid start date and time in the clinic’s time zone. Avoid times skipped or repeated when the clocks change.',
  end: 'Enter a valid end date and time in the clinic’s time zone. Avoid times skipped or repeated when the clocks change.',
  range: 'The end must be after the start. Please check both times.',
  reason: 'Keep the reason to 500 characters or fewer, or leave it empty.',
} as const;
export type TimeBlockErrorCode = keyof typeof TIME_BLOCK_ERRORS;
export class TimeBlockInputError extends Error {
  constructor(readonly code: TimeBlockErrorCode) {
    super(TIME_BLOCK_ERRORS[code]);
  }
}

const inputSchema = z.strictObject({
  practitionerId: z.uuid(),
  start: z.string(),
  end: z.string(),
  reason: z.string().trim().max(500),
});

function localInstant(value: string, zone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  try {
    const [date, time] = value.split('T') as [string, string];
    const instant = zonedTimeToUtc(date, time, zone);
    if (!instant) return null;
    // Refuse repeated wall-clock times rather than silently choosing one occurrence.
    const ms = instant.getTime();
    const offset = timeZoneOffsetMs(ms, zone);
    for (const probe of [ms - 12 * 3_600_000, ms + 12 * 3_600_000]) {
      const alternative = new Date(ms + offset - timeZoneOffsetMs(probe, zone));
      if (
        alternative.getTime() !== ms &&
        localDateOf(alternative, zone) === date &&
        formatLocalTime(alternative, zone) === time
      )
        return null;
    }
    return instant;
  } catch {
    return null;
  }
}

export function parseTimeBlock(input: unknown, timeZone: string) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new TimeBlockInputError(
      field === 'reason' ? 'reason' : field === 'start' ? 'start' : field === 'end' ? 'end' : 'practitioner',
    );
  }
  const startsAt = localInstant(parsed.data.start, timeZone);
  if (!startsAt) throw new TimeBlockInputError('start');
  const endsAt = localInstant(parsed.data.end, timeZone);
  if (!endsAt) throw new TimeBlockInputError('end');
  if (endsAt <= startsAt) throw new TimeBlockInputError('range');
  return { practitionerId: parsed.data.practitionerId, startsAt, endsAt, reason: parsed.data.reason || null };
}
