import { describe, expect, it } from 'vitest';
import { parseBlockPeriod } from '@/server/admin/blocked-periods';

const zone = 'Europe/London';
const input = {
  practitionerId: '019a0000-0000-7000-8000-000000000001',
  start: '2026-10-24T14:00',
  end: '2026-10-26T14:00',
};

describe('blocked period input', () => {
  it('converts both ends in the clinic time zone across a clock change and permits no reason', () => {
    expect(parseBlockPeriod(input, zone)).toEqual({
      period: {
        practitionerId: input.practitionerId,
        startsAt: new Date('2026-10-24T13:00:00Z'),
        endsAt: new Date('2026-10-26T14:00:00Z'),
        reason: null,
      },
    });
  });

  it('uses the first occurrence of a repeated local time', () => {
    expect(parseBlockPeriod({ ...input, start: '2026-10-25T01:30' }, zone).period?.startsAt).toEqual(
      new Date('2026-10-25T00:30:00Z'),
    );
  });

  it.each([
    [{ start: '2026-03-29T01:30' }, 'invalid_start'],
    [{ end: '2026-11-31T14:00' }, 'invalid_end'],
    [{ end: input.start }, 'invalid_order'],
    [{ end: '2026-10-24T13:00' }, 'invalid_order'],
    [{ practitionerId: 'unknown' }, 'invalid_practitioner'],
    [{ reason: 'x'.repeat(241) }, 'invalid_reason'],
  ])('rejects invalid block fields %j', (fields, error) => {
    expect(parseBlockPeriod({ ...input, ...fields }, zone)).toEqual({ error });
  });
});
