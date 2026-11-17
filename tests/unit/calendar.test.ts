import { describe, expect, it } from 'vitest';
import { bookingCalendar, calendarLinks } from '@/server/bookings/calendar';

const booking = {
  id: '019a0000-0000-7000-8000-00000000b001',
  startsAt: new Date('2026-10-22T09:30:00Z'),
  endsAt: new Date('2026-10-22T10:15:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  rescheduleCount: 0,
  practitionerName: 'Pat Physio',
};
const settings = { clinicName: 'Acme Physio', timeZone: 'Europe/London' };
const unfold = (value: string) => value.replace(/\r\n /g, '');

describe('booking calendars', () => {
  it.each([
    ['2026-03-27T10:30:00Z', '20260327T103000Z', '10:30'],
    ['2026-03-30T09:30:00Z', '20260330T093000Z', '10:30'],
    ['2026-10-23T09:30:00Z', '20261023T093000Z', '10:30'],
    ['2026-10-26T10:30:00Z', '20261026T103000Z', '10:30'],
  ])('keeps the correct UK time across clock changes: %s', (instant, utc, local) => {
    const startsAt = new Date(instant);
    const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
    const value = { ...booking, startsAt, endsAt };
    const file = unfold(bookingCalendar(value, settings));
    expect(file).toContain(`DTSTART:${utc}\r\n`);
    expect(file).toContain(`DTEND:${endsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}\r\n`);
    expect(file).toContain(`${local} (Europe/London)`);
    expect(file).toContain('45 minutes');
    expect(file).toContain('SUMMARY:Acme Physio with Pat Physio\r\n');
    expect(file).toContain('LOCATION:Acme Physio\r\n');
    expect(file).toContain('VERSION:2.0\r\n');
    expect(file).toContain('METHOD:PUBLISH\r\n');
    expect(file).toMatch(/END:VCALENDAR\r\n$/);
    const links = calendarLinks(value, settings);
    const google = new URL(links.google);
    expect(google.origin).toBe('https://calendar.google.com');
    expect(google.searchParams.get('dates')).toBe(
      `${utc}/${endsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}`,
    );
    expect(google.searchParams.get('ctz')).toBe('Europe/London');
    expect(google.searchParams.get('text')).toBe('Acme Physio with Pat Physio');
    const outlook = new URL(links.outlook);
    expect(outlook.origin).toBe('https://outlook.live.com');
    expect(outlook.searchParams.get('startdt')).toBe(startsAt.toISOString());
    expect(outlook.searchParams.get('enddt')).toBe(endsAt.toISOString());
    expect(outlook.searchParams.get('subject')).toBe('Acme Physio with Pat Physio');
  });

  it('uses the saved end time, and keeps the same identity with a newer sequence after a move', () => {
    const moved = { ...booking, endsAt: new Date('2026-10-22T10:30:00Z'), rescheduleCount: 1 };
    const original = unfold(bookingCalendar(booking, settings));
    const updated = unfold(bookingCalendar(moved, settings));
    expect(updated).toContain('60 minutes');
    expect(updated).toContain('SEQUENCE:1\r\n');
    expect(original.match(/UID:[^\r]+/)?.[0]).toBe(updated.match(/UID:[^\r]+/)?.[0]);
    expect(updated).toContain('DTSTAMP:20261020T070000Z\r\n');
  });

  it('escapes calendar text and folds long Unicode lines within 75 bytes', () => {
    const clinicName = 'Clinique É'.repeat(12) + ',;\\\nBEGIN:VEVENT';
    const file = bookingCalendar({ ...booking, practitionerName: 'Pat, One; Two' }, { ...settings, clinicName });
    expect(unfold(file)).toContain('Pat\\, One\\; Two');
    expect(unfold(file)).toContain('\\,\\;\\\\\\nBEGIN:VEVENT');
    expect(file.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    for (const line of file.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(file).not.toContain('�');
  });
});
