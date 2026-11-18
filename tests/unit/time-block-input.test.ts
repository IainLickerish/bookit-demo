import { describe, expect, it } from 'vitest';
import { parseTimeBlock } from '@/server/admin/time-block-input';

const input = {
  practitionerId: '019a0000-0000-7000-8000-000000000001',
  start: '2026-10-22T09:30',
  end: '2026-10-22T10:30',
  reason: '  Training  ',
};
describe('clinic-local time block input', () => {
  it('uses summer and winter offsets and allows multi-day ranges', () => {
    expect(parseTimeBlock(input, 'Europe/London')).toMatchObject({
      startsAt: new Date('2026-10-22T08:30:00Z'),
      reason: 'Training',
    });
    expect(
      parseTimeBlock({ ...input, start: '2026-10-24T09:30', end: '2026-10-26T10:30' }, 'Europe/London'),
    ).toMatchObject({ startsAt: new Date('2026-10-24T08:30:00Z'), endsAt: new Date('2026-10-26T10:30:00Z') });
  });
  it('refuses nonexistent, skipped and repeated times, equal ranges and oversized reasons', () => {
    for (const start of ['2026-02-30T10:00', '2026-03-29T01:30', '2026-10-25T01:30', 'not a date']) {
      expect(() => parseTimeBlock({ ...input, start }, 'Europe/London')).toThrow();
    }
    expect(() => parseTimeBlock({ ...input, end: input.start }, 'Europe/London')).toThrow('end must be after');
    expect(() => parseTimeBlock({ ...input, reason: 'x'.repeat(501) }, 'Europe/London')).toThrow('500 characters');
  });
});
