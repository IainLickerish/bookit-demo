import { describe, expect, it } from 'vitest';
import { blockInput, blockInstant } from '@/server/admin/blocks';

describe('blocked period validation', () => {
  it('accepts ordinary UK winter and summer times in the clinic time zone', () => {
    expect(blockInstant('2026-11-17T09:15', 'Europe/London')?.toISOString()).toBe('2026-11-17T09:15:00.000Z');
    expect(blockInstant('2027-07-01T09:15', 'Europe/London')?.toISOString()).toBe('2027-07-01T08:15:00.000Z');
    expect(blockInstant('2027-07-01T09:15', 'Europe/Paris')?.toISOString()).toBe('2027-07-01T07:15:00.000Z');
  });

  it.each(['2026-02-30T09:00', '2026-10-25T01:30', '2027-03-28T01:30', '2026-11-17T25:00', 'invalid'])(
    'rejects an invalid, skipped or repeated local time: %s',
    (value) => {
      expect(blockInstant(value, 'Europe/London')).toBeNull();
    },
  );

  it('accepts an empty reason and rejects oversized reasons and clinic selectors', () => {
    const value = {
      practitionerId: '019a0000-0000-7000-8000-000000000001',
      startsAt: '2026-11-17T09:00',
      endsAt: '2026-11-17T10:00',
      reason: '',
    };
    expect(blockInput.safeParse(value).success).toBe(true);
    expect(blockInput.safeParse({ ...value, reason: 'x'.repeat(501) }).success).toBe(false);
    expect(blockInput.safeParse({ ...value, tenant: 'beacon' }).success).toBe(false);
  });
});
