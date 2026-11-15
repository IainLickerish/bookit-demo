import { describe, expect, it } from 'vitest';
import { InvalidBlockError, parseBlockedPeriod } from '@/server/admin/blocked-time';

const input = {
  practitionerId: '019a0000-0000-7000-8000-000000000001',
  start: '2026-11-20T09:00',
  end: '2026-11-20T17:00',
  reason: '  Training  ',
};

describe('blocked period validation and clinic time', () => {
  it('trims the optional reason and accepts a period without one', () => {
    expect(parseBlockedPeriod(input, 'Europe/London').reason).toBe('Training');
    expect(parseBlockedPeriod({ ...input, reason: '  ' }, 'Europe/London').reason).toBeNull();
  });
  it.each([
    { practitionerId: 'another-clinic' },
    { start: '' },
    { end: '' },
    { start: '2026-02-30T09:00' },
    { start: '2026-11-20T25:00' },
    { end: input.start },
    { end: '2026-11-19T17:00' },
    { reason: 'x'.repeat(501) },
    { start: '2026-03-29T01:30', end: '2026-03-29T03:00' },
  ])('refuses invalid entries: %j', (change) => {
    expect(() => parseBlockedPeriod({ ...input, ...change }, 'Europe/London')).toThrow(InvalidBlockError);
  });
  it('uses summer and winter clinic time, including periods crossing a clock change', () => {
    const summer = parseBlockedPeriod(
      { ...input, start: '2026-07-10T09:00', end: '2026-07-10T17:00' },
      'Europe/London',
    );
    expect(summer.startsAt.toISOString()).toBe('2026-07-10T08:00:00.000Z');
    const winter = parseBlockedPeriod(input, 'Europe/London');
    expect(winter.startsAt.toISOString()).toBe('2026-11-20T09:00:00.000Z');
    const change = parseBlockedPeriod(
      { ...input, start: '2026-10-24T09:00', end: '2026-10-25T09:00' },
      'Europe/London',
    );
    expect(change.endsAt.getTime() - change.startsAt.getTime()).toBe(25 * 60 * 60_000);
  });
  it('uses the first occurrence of a repeated time, as explained on the form', () => {
    expect(
      parseBlockedPeriod(
        { ...input, start: '2026-10-25T01:30', end: '2026-10-25T02:30' },
        'Europe/London',
      ).startsAt.toISOString(),
    ).toBe('2026-10-25T00:30:00.000Z');
  });
});
