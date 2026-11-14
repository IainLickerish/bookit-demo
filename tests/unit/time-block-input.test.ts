import { describe, expect, it } from 'vitest';
import { parseTimeBlock, TimeBlockInputError, type TimeBlockValues } from '@/server/admin/time-block-input';

const input: TimeBlockValues = {
  practitionerId: '019a0000-0000-7000-8000-000000000001',
  start: '2026-10-24T09:00',
  end: '2026-10-26T09:00',
  reason: ' Training ',
};
const parse = (values: Partial<TimeBlockValues>) => parseTimeBlock({ ...input, ...values }, 'Europe/London');

function errors(values: Partial<TimeBlockValues>) {
  try {
    parse(values);
  } catch (error) {
    if (error instanceof TimeBlockInputError) return error.fields;
    throw error;
  }
  throw new Error('Expected invalid input');
}

describe('staff blocked time input', () => {
  it('uses each endpoint’s London offset across the autumn clock change', () => {
    const result = parse({});
    expect(result.startsAt.toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(result.endsAt.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(result.reason).toBe('Training');
  });
  it('uses each endpoint’s London offset across the spring clock change', () => {
    const result = parse({ start: '2027-03-27T09:00', end: '2027-03-29T09:00', reason: '' });
    expect(result.startsAt.toISOString()).toBe('2027-03-27T09:00:00.000Z');
    expect(result.endsAt.toISOString()).toBe('2027-03-29T08:00:00.000Z');
    expect(result.reason).toBeNull();
  });
  it('rejects skipped and repeated wall-clock times rather than guessing', () => {
    expect(errors({ start: '2027-03-28T01:30' })).toMatchObject({ start: 'skipped_time' });
    expect(errors({ end: '2026-10-25T01:30' })).toMatchObject({ end: 'repeated_time' });
  });
  it.each(['', '2026-02-30T09:00', '2026-10-24T24:00', '2026-10-24T09:60', '2026-10-24T09:00Z', '0026-10-24T09:00'])(
    'rejects an invalid local date and time: %s',
    (start) => {
      expect(errors({ start })).toMatchObject({ start: 'invalid_time' });
    },
  );
  it('reports errors for every invalid field together without changing the supplied values', () => {
    const values = { ...input, practitionerId: 'wrong', start: 'invalid', end: '', reason: 'x'.repeat(501) };
    expect(errors(values)).toEqual({
      practitionerId: 'practitioner',
      start: 'invalid_time',
      end: 'invalid_time',
      reason: 'reason_long',
    });
    expect(values.start).toBe('invalid');
    expect(values.reason).toHaveLength(501);
  });
  it.each(['2026-10-24T08:59', '2026-10-24T09:00'])('rejects an end no later than the start: %s', (end) => {
    expect(errors({ end })).toEqual({ end: 'end_order' });
  });
});
