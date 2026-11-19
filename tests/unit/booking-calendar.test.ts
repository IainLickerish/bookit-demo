import { expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';

it('keeps punctuation and long accented names in a single calendar event', () => {
  const clinicName = 'Acme, Physio; North\\West';
  const practitionerName = `${'Zoë '.repeat(20)}\r\nATTENDEE:mailto:injected@example.test`;
  const calendar = bookingCalendar(
    {
      id: '019a0000-0000-7000-8000-00000000b001',
      updatedAt: new Date('2026-10-20T07:00:00Z'),
      rescheduleCount: 0,
      startsAt: new Date('2026-10-22T08:00:00Z'),
      endsAt: new Date('2026-10-22T08:30:00Z'),
      practitionerName,
    },
    { clinicName, timeZone: 'Europe/London' },
  );

  expect(calendar.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
  expect(calendar).toContain('\r\n ');
  expect(calendar).not.toContain('\r\nATTENDEE:');
  for (const line of calendar.split('\r\n')) {
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  }
  const unfolded = calendar.replaceAll('\r\n ', '');
  expect(unfolded).toContain(
    `SUMMARY:Acme\\, Physio\\; North\\\\West session with ${'Zoë '.repeat(20)}\\nATTENDEE:mailto:injected@example.test\r\n`,
  );
  expect(unfolded).toContain('DESCRIPTION:When: Thu\\, 22 Oct 2026\\, 09:00 (Europe/London)\\nLength: 30 minutes\r\n');
});
