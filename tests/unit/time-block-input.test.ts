import { describe, expect, it } from 'vitest';
import { parseTimeBlock, TIME_BLOCK_REASON_LIMIT } from '@/server/admin/time-block-input';

const timeZone = 'Europe/London';
const fields = {
  practitionerId: '019a0000-0000-7000-8000-000000000001',
  startsAt: '2026-10-23T09:15',
  endsAt: '2026-10-26T10:30',
  reason: ' Annual leave ',
};

describe('time block input', () => {
  it('converts both ends in the clinic zone across a clock change', () => {
    expect(parseTimeBlock(fields, timeZone)).toEqual({
      status: 'valid',
      block: {
        practitionerId: fields.practitionerId,
        startsAt: new Date('2026-10-23T08:15:00Z'),
        endsAt: new Date('2026-10-26T10:30:00Z'),
        reason: 'Annual leave',
      },
    });
  });

  it.each(['2026-03-29T01:15', '2026-10-25T01:15'])('rejects a skipped or repeated clock time %s', (startsAt) => {
    expect(parseTimeBlock({ ...fields, startsAt }, timeZone)).toEqual({ status: 'clock_change' });
  });

  it.each([
    { startsAt: '2026-02-30T09:00' },
    { startsAt: '2026-10-23T24:00' },
    { practitionerId: 'unknown' },
    { reason: 'a'.repeat(TIME_BLOCK_REASON_LIMIT + 1) },
  ])('rejects invalid fields %j', (change) => {
    expect(parseTimeBlock({ ...fields, ...change }, timeZone)).toEqual({ status: 'invalid_fields' });
  });

  it.each([fields.startsAt, '2026-10-22T09:15'])('requires the end %s to follow the start', (endsAt) => {
    expect(parseTimeBlock({ ...fields, endsAt }, timeZone)).toEqual({ status: 'invalid_range' });
  });
});
