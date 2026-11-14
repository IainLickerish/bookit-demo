import { z } from 'zod';
import { isLocalDate, zonedTimeCandidates } from '@/lib/time';

export interface TimeBlockValues {
  practitionerId: string;
  start: string;
  end: string;
  reason: string;
}

export type BlockField = keyof TimeBlockValues;
export type BlockErrorCode =
  'practitioner' | 'invalid_time' | 'skipped_time' | 'repeated_time' | 'end_order' | 'reason_long';
export type BlockFieldErrors = Partial<Record<BlockField, BlockErrorCode>>;

export class TimeBlockInputError extends Error {
  constructor(readonly fields: BlockFieldErrors) {
    super('Invalid time block');
  }
}

const localDateTime = /^([1-9]\d{3}-\d{2}-\d{2})T([0-2]\d:[0-5]\d)$/;

export function parseTimeBlock(values: TimeBlockValues, timeZone: string) {
  const errors: BlockFieldErrors = {};
  if (!z.uuid().safeParse(values.practitionerId).success) errors.practitionerId = 'practitioner';
  if (values.reason.trim().length > 500) errors.reason = 'reason_long';
  const parse = (field: 'start' | 'end'): Date | undefined => {
    const match = localDateTime.exec(values[field]);
    if (!match || !isLocalDate(match[1]!) || Number(match[2]!.slice(0, 2)) > 23) {
      errors[field] = 'invalid_time';
      return;
    }
    const candidates = zonedTimeCandidates(match[1]!, match[2]!, timeZone);
    if (candidates.length !== 1) {
      errors[field] = candidates.length === 0 ? 'skipped_time' : 'repeated_time';
      return;
    }
    return candidates[0];
  };
  const startsAt = parse('start');
  const endsAt = parse('end');
  if (startsAt && endsAt && endsAt <= startsAt) errors.end = 'end_order';
  if (Object.keys(errors).length || !startsAt || !endsAt) throw new TimeBlockInputError(errors);
  return { practitionerId: values.practitionerId, startsAt, endsAt, reason: values.reason.trim() || null };
}
