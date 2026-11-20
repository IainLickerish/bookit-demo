import { expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';

const settings = { clinicName: 'Acme Physio', timeZone: 'Europe/London' };
const session = {
  id: '019a0000-0000-7000-8000-00000000b001',
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  rescheduleCount: 0,
  startsAt: new Date('2026-10-22T23:15:00Z'),
  endsAt: new Date('2026-10-22T23:45:00Z'),
  practitionerName: 'Pat Physio',
};

it('keeps the UK date, time and actual length of a session across the clock change', () => {
  const summer = bookingCalendar(session, settings).replaceAll('\r\n ', '');
  expect(summer).toContain('SUMMARY:Acme Physio session with Pat Physio\r\nLOCATION:Acme Physio\r\n');
  expect(summer).toContain('DTSTART:20261022T231500Z\r\nDTEND:20261022T234500Z\r\n');
  expect(summer).toContain('DESCRIPTION:When: Fri\\, 23 Oct 2026\\, 00:15 (Europe/London)\\nLength: 30 minutes\r\n');

  const winter = bookingCalendar(
    { ...session, startsAt: new Date('2026-10-29T00:15:00Z'), endsAt: new Date('2026-10-29T01:00:00Z') },
    settings,
  ).replaceAll('\r\n ', '');
  expect(winter).toContain('DTSTART:20261029T001500Z\r\nDTEND:20261029T010000Z\r\n');
  expect(winter).toContain('DESCRIPTION:When: Thu\\, 29 Oct 2026\\, 00:15 (Europe/London)\\nLength: 45 minutes\r\n');
});

it('keeps accented calendar text intact and escapes separators and line breaks', () => {
  const calendar = bookingCalendar({ ...session, practitionerName: `${'É'.repeat(40)}, A; B\\C\r\nD` }, settings);
  expect(calendar.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  expect(calendar.replaceAll('\r\n ', '')).toContain(
    `SUMMARY:Acme Physio session with ${'É'.repeat(40)}\\, A\\; B\\\\C\\nD\r\n`,
  );
});
