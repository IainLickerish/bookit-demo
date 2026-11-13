import { describe, expect, it } from 'vitest';
import { blockInstant, blockedTimeInput } from '@/server/admin/blocked-time';

describe('blocked time validation in the clinic time zone', () => {
  it('converts ordinary clinic times on both sides of the clock change', () => {
    expect(blockInstant('2026-10-24T09:00', 'Europe/London')?.toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(blockInstant('2026-10-26T09:00', 'Europe/London')?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });
  it.each(['2026-03-29T01:30', '2026-10-25T01:30', '2026-02-30T09:00', '2026-10-20T24:00', 'invalid'])(
    'rejects impossible or ambiguous time %s',
    (value) => {
      expect(blockInstant(value, 'Europe/London')).toBeNull();
    },
  );
  it('accepts an empty optional reason and trims notes, refusing excess text and tenant selectors', () => {
    const input = {
      practitionerId: '019a0000-0000-7000-8000-000000000001',
      start: '2026-10-26T09:00',
      end: '2026-10-26T10:00',
      reason: '',
    };
    expect(blockedTimeInput.parse(input).reason).toBe('');
    expect(blockedTimeInput.parse({ ...input, reason: ' Training ' }).reason).toBe('Training');
    expect(blockedTimeInput.safeParse({ ...input, reason: 'x'.repeat(301) }).success).toBe(false);
    expect(blockedTimeInput.safeParse({ ...input, tenant: 'beacon' }).success).toBe(false);
  });
});
