import { describe, expect, it } from 'vitest';
import { parseTimeOffInput, TimeOffInputRejected, type TimeOffFormInput } from '@/server/admin/time-off';

const PRACTITIONER = '0190f5e4-0000-7000-8000-000000000001';
const now = new Date('2026-10-20T07:00:00Z');

function input(overrides: Partial<TimeOffFormInput> = {}): TimeOffFormInput {
  return { practitionerId: PRACTITIONER, start: '2026-10-22T09:00', end: '2026-10-22T17:00', reason: '', ...overrides };
}

function refusal(value: unknown): string {
  try {
    parseTimeOffInput(value, 'Europe/London', now);
    return 'none';
  } catch (error) {
    if (error instanceof TimeOffInputRejected) return error.code;
    throw error;
  }
}

describe('practitioner time off input', () => {
  it('reads clinic-local times on both sides of a clock change', () => {
    expect(parseTimeOffInput(input(), 'Europe/London', now)).toEqual({
      practitionerId: PRACTITIONER,
      startsAt: new Date('2026-10-22T08:00:00Z'),
      endsAt: new Date('2026-10-22T16:00:00Z'),
      reason: null,
    });
    const winter = parseTimeOffInput(
      input({ start: '2026-10-24T09:00', end: '2026-10-26T09:00', reason: '  Training course ' }),
      'Europe/London',
      now,
    );
    expect(winter.startsAt).toEqual(new Date('2026-10-24T08:00:00Z'));
    expect(winter.endsAt).toEqual(new Date('2026-10-26T09:00:00Z'));
    expect(winter.reason).toBe('Training course');
  });

  it('allows time off that has already started but not ended', () => {
    expect(refusal(input({ start: '2026-10-19T09:00', end: '2026-10-20T17:00' }))).toBe('none');
  });

  it('refuses malformed, reversed, past, over-long and skipped-hour periods', () => {
    expect(refusal(input({ practitionerId: 'not-a-uuid' }))).toBe('invalid');
    expect(refusal(input({ start: '2026-10-22' }))).toBe('invalid');
    expect(refusal(input({ start: '2026-02-30T09:00' }))).toBe('invalid');
    expect(refusal(input({ reason: 'x'.repeat(201) }))).toBe('invalid');
    expect(refusal({ ...input(), tenant: 'beacon' })).toBe('invalid');
    expect(refusal(input({ start: '2027-03-28T01:30', end: '2027-03-28T05:00' }))).toBe('invalid');
    expect(refusal(input({ end: '2026-10-22T09:00' }))).toBe('end_before_start');
    expect(refusal(input({ end: '2026-10-22T08:00' }))).toBe('end_before_start');
    expect(refusal(input({ start: '2026-10-18T09:00', end: '2026-10-19T17:00' }))).toBe('already_over');
    expect(refusal(input({ end: '2027-10-23T17:00' }))).toBe('too_long');
  });
});
