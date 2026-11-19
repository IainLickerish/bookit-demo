import { expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';

const clinic = { clinicName: 'Acme Physio', timeZone: 'Pacific/Honolulu' };
const booking = {
  id: '019a0000-0000-7000-8000-00000000b001',
  practitionerName: 'Pat Physio',
  startsAt: new Date('2026-10-22T09:30:00Z'),
  endsAt: new Date('2026-10-22T10:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  rescheduleCount: 0,
};

it('preserves the clinic, physiotherapist, UK time and saved duration across the clock change', () => {
  const summer = bookingCalendar(booking, clinic);
  const winter = bookingCalendar(
    {
      ...booking,
      startsAt: new Date('2026-10-29T10:30:00Z'),
      endsAt: new Date('2026-10-29T11:30:00Z'),
      updatedAt: new Date('2026-10-21T12:00:00Z'),
      rescheduleCount: 1,
    },
    clinic,
  );

  expect(summer).toContain('SUMMARY:Acme Physio session with Pat Physio\r\n');
  expect(summer).toContain('LOCATION:Acme Physio\r\n');
  expect(summer).toContain('DTSTART:20261022T093000Z\r\nDTEND:20261022T100000Z\r\n');
  expect(summer.replace(/\r\n /g, '')).toContain('Thu\\, 22 Oct 2026\\, 10:30 (Europe/London)\\n30 minutes');
  expect(summer).toContain('DTSTAMP:20261020T070000Z\r\n');
  expect(summer).toContain('SEQUENCE:0\r\n');

  expect(winter).toContain('SUMMARY:Acme Physio session with Pat Physio\r\n');
  expect(winter).toContain('DTSTART:20261029T103000Z\r\nDTEND:20261029T113000Z\r\n');
  expect(winter.replace(/\r\n /g, '')).toContain('Thu\\, 29 Oct 2026\\, 10:30 (Europe/London)\\n60 minutes');
  expect(winter).toContain('DTSTAMP:20261021T120000Z\r\n');
  expect(winter).toContain('SEQUENCE:1\r\n');
  expect(winter.match(/^UID:.+$/m)?.[0]).toBe(summer.match(/^UID:.+$/m)?.[0]);
  expect(summer).toContain(`UID:${booking.id}@bookit.test\r\n`);
});

it('escapes text and folds long names without splitting UTF-8 characters', () => {
  const practitionerName = `${'Élodie '.repeat(12)}Léa, Jr.; MSc\\Physio\r\nBEGIN:VEVENT`;
  const calendar = bookingCalendar({ ...booking, practitionerName }, clinic);
  const lines = calendar.split('\r\n');

  expect(lines.every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
  expect(calendar.replace(/\r\n /g, '')).toContain(
    `SUMMARY:Acme Physio session with ${'Élodie '.repeat(12)}Léa\\, Jr.\\; MSc\\\\Physio\\nBEGIN:VEVENT\r\n`,
  );
  expect(calendar.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
  expect(calendar.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
});
