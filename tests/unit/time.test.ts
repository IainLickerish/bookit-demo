import { describe, expect, it } from 'vitest';
import {
  addDaysToLocalDate,
  formatLocalTime,
  formatSlot,
  isLocalDate,
  isoWeekday,
  isValidTimeZone,
  localDateOf,
  startOfLocalDate,
  timeZoneOffsetMs,
  zonedTimeToUtc,
} from '@/lib/time';

const LONDON = 'Europe/London';

describe('clinic time zone helpers (REQ-18.1-01)', () => {
  it('formats summer and winter instants in Europe/London at the local wall-clock time', () => {
    expect(formatSlot(new Date('2026-07-01T08:00:00Z'), LONDON)).toBe('Wed, 1 Jul 2026, 09:00');
    expect(formatSlot(new Date('2026-12-01T09:00:00Z'), LONDON)).toBe('Tue, 1 Dec 2026, 09:00');
    expect(formatLocalTime(new Date('2026-10-23T08:00:00Z'), LONDON)).toBe('09:00');
    expect(formatLocalTime(new Date('2026-10-26T09:00:00Z'), LONDON)).toBe('09:00');
  });

  it('converts local times to UTC on both sides of the October 2026 clock change', () => {
    expect(zonedTimeToUtc('2026-10-23', '09:00', LONDON)?.toISOString()).toBe('2026-10-23T08:00:00.000Z');
    expect(zonedTimeToUtc('2026-10-26', '09:00', LONDON)?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });

  it('returns null for a local time skipped when the clocks go forward', () => {
    expect(zonedTimeToUtc('2027-03-28', '01:30', LONDON)).toBeNull();
    expect(zonedTimeToUtc('2027-03-28', '02:30', LONDON)?.toISOString()).toBe('2027-03-28T01:30:00.000Z');
  });

  it('returns the earlier instant for a local time that occurs twice when the clocks go back', () => {
    expect(zonedTimeToUtc('2026-10-25', '01:30', LONDON)?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('handles zones east of UTC and half-hour offsets', () => {
    expect(zonedTimeToUtc('2026-10-20', '09:00', 'Australia/Sydney')?.toISOString()).toBe('2026-10-19T22:00:00.000Z');
    expect(zonedTimeToUtc('2026-10-20', '09:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-10-20T03:30:00.000Z');
    expect(timeZoneOffsetMs(Date.UTC(2026, 9, 20), 'Asia/Kolkata')).toBe(5.5 * 3_600_000);
  });

  it('finds the local date of an instant near midnight', () => {
    expect(localDateOf(new Date('2026-07-01T23:30:00Z'), LONDON)).toBe('2026-07-02');
    expect(localDateOf(new Date('2026-12-31T23:30:00Z'), LONDON)).toBe('2026-12-31');
  });

  it('does calendar arithmetic on local dates', () => {
    expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToLocalDate('2027-03-01', -1)).toBe('2027-02-28');
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-10-20')).toBe(true);
    expect(isLocalDate('20-10-2026')).toBe(false);
  });

  it('finds the first instant of a local date', () => {
    expect(startOfLocalDate('2026-07-01', LONDON).toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(startOfLocalDate('2026-12-01', LONDON).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('recognises IANA time zone names', () => {
    expect(isValidTimeZone(LONDON)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
