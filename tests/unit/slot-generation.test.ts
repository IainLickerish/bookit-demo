import { describe, expect, it } from 'vitest';
import { formatLocalTime, isoWeekday, localDateOf } from '@/lib/time';
import { generateSlotTimes, type SlotTemplate } from '@/server/slots/generate';

const LONDON = 'Europe/London';

const weekdays45: SlotTemplate = {
  workingDays: [1, 2, 3, 4, 5],
  workdayStart: '09:00',
  workdayEnd: '17:00',
  sessionMinutes: 45,
  timeZone: LONDON,
};

const ACME_LOCAL_STARTS = ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '13:30', '14:15', '15:00', '15:45'];

/** Weekdays (Mon to Fri) from start to end inclusive, by plain UTC date arithmetic. */
function countWeekdays(start: string, end: string): number {
  let count = 0;
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day >= 1 && day <= 5) {
      count += 1;
    }
  }
  return count;
}

describe('slot generation up to the booking horizon (REQ-18.1-01)', () => {
  const from = new Date('2026-10-20T07:00:00Z');
  const slots = generateSlotTimes(weekdays45, from, 220);
  const horizonEnd = new Date('2027-05-28T07:00:00Z');

  it('creates slots only after now and no later than now plus the horizon', () => {
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.startsAt.getTime()).toBeGreaterThan(from.getTime());
      expect(slot.startsAt.getTime()).toBeLessThanOrEqual(horizonEnd.getTime());
      expect(slot.endsAt.getTime() - slot.startsAt.getTime()).toBe(45 * 60_000);
    }
  });

  it('fills every working day up to the horizon with the same local start times', () => {
    // The horizon ends at 08:00 local on Friday 28 May 2027, before the first
    // slot of that day, so the last bookable day is Thursday 27 May.
    expect(slots.length).toBe(countWeekdays('2026-10-20', '2027-05-27') * 10);
    expect(localDateOf(slots.at(-1)!.startsAt, LONDON)).toBe('2027-05-27');
    expect(formatLocalTime(slots.at(-1)!.startsAt, LONDON)).toBe('15:45');
    const firstDay = slots.filter((s) => localDateOf(s.startsAt, LONDON) === '2026-10-20');
    expect(firstDay.map((s) => formatLocalTime(s.startsAt, LONDON))).toEqual(ACME_LOCAL_STARTS);
  });

  it('keeps slots at their local times on both sides of each clock change', () => {
    for (const slot of slots) {
      expect(ACME_LOCAL_STARTS).toContain(formatLocalTime(slot.startsAt, LONDON));
    }
    const isoStarts = slots.map((s) => s.startsAt.toISOString());
    expect(isoStarts).toContain('2026-10-23T08:00:00.000Z'); // Friday before, BST
    expect(isoStarts).toContain('2026-10-26T09:00:00.000Z'); // Monday after, GMT
    expect(isoStarts).toContain('2027-03-26T09:00:00.000Z'); // Friday before, GMT
    expect(isoStarts).toContain('2027-03-29T08:00:00.000Z'); // Monday after, BST
  });

  it('skips days the practitioner does not work', () => {
    for (const slot of slots) {
      expect(isoWeekday(localDateOf(slot.startsAt, LONDON))).toBeLessThanOrEqual(5);
    }
  });

  it('does not offer a slot that starts exactly now', () => {
    const midday = generateSlotTimes(weekdays45, new Date('2026-10-20T11:00:00Z'), 1);
    expect(formatLocalTime(midday[0]!.startsAt, LONDON)).toBe('12:45');
  });

  it('supports 30-minute appointments and Saturday working', () => {
    const beaconLike = generateSlotTimes(
      {
        ...weekdays45,
        workingDays: [1, 2, 3, 4, 5, 6],
        workdayStart: '08:00',
        workdayEnd: '18:00',
        sessionMinutes: 30,
      },
      new Date('2026-10-23T23:00:00Z'),
      2,
    );
    const saturday = beaconLike.filter((s) => localDateOf(s.startsAt, LONDON) === '2026-10-24');
    expect(saturday).toHaveLength(20);
    expect(formatLocalTime(saturday[0]!.startsAt, LONDON)).toBe('08:00');
    expect(formatLocalTime(saturday.at(-1)!.startsAt, LONDON)).toBe('17:30');
  });
});
