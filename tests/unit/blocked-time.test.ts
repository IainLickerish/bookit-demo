import { describe, expect, it } from 'vitest';
import { parseBlockedTime } from '@/server/admin/blocked-time';

const input = {
  practitionerId: '019a0000-0000-7000-8000-000000000001',
  start: '2027-07-12T09:00',
  end: '2027-07-14T17:00',
  reason: ' Holiday ',
};

describe('blocked time input', () => {
  it('converts a multi-day absence from clinic time and trims the optional reason', () => {
    const result = parseBlockedTime(input, 'Europe/London');
    expect(result.startsAt.toISOString()).toBe('2027-07-12T08:00:00.000Z');
    expect(result.endsAt.toISOString()).toBe('2027-07-14T16:00:00.000Z');
    expect(result.reason).toBe('Holiday');
    expect(parseBlockedTime({ ...input, reason: '  ' }, 'Europe/London').reason).toBeNull();
  });

  it.each([
    { practitionerId: 'unknown' },
    { end: input.start },
    { end: '2027-07-11T09:00' },
    { start: '2027-02-30T09:00' },
    { start: '2027-07-12T25:00' },
    { start: '2027-03-28T01:30' },
    { reason: 'x'.repeat(501) },
  ])('rejects invalid absence details: %j', (change) => {
    expect(() => parseBlockedTime({ ...input, ...change }, 'Europe/London')).toThrow();
  });

  it('uses the first occurrence when the clock repeats a time', () => {
    const result = parseBlockedTime({ ...input, start: '2027-10-31T01:30', end: '2027-10-31T02:30' }, 'Europe/London');
    expect(result.startsAt.toISOString()).toBe('2027-10-31T00:30:00.000Z');
    expect(result.endsAt.toISOString()).toBe('2027-10-31T02:30:00.000Z');
  });
});
