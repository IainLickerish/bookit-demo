import { describe, expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';

const settings = { clinicName: 'Acme Physio', timeZone: 'Europe/London' };
const booking = {
  id: '019a0000-0000-7000-8000-00000000b001',
  startsAt: new Date('2026-10-22T09:30:00Z'),
  endsAt: new Date('2026-10-22T10:15:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  practitionerName: 'Pat Physio',
  rescheduleCount: 0,
};

describe('booking calendar', () => {
  it('includes the clinic, physiotherapist, UK summer and winter times, and the saved session length', () => {
    const summer = bookingCalendar(booking, settings).replaceAll('\r\n ', '');
    expect(summer).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    expect(summer).toContain('\r\nBEGIN:VEVENT\r\n');
    expect(summer).toContain('\r\nSUMMARY:Acme Physio session with Pat Physio\r\n');
    expect(summer).toContain('\r\nLOCATION:Acme Physio\r\n');
    expect(summer).toContain('\r\nDTSTART:20261022T093000Z\r\nDTEND:20261022T101500Z\r\n');
    expect(summer).toContain(
      '\r\nDESCRIPTION:Physiotherapist: Pat Physio\\nTime at the clinic: Thu\\, 22 Oct 2026\\, 10:30 (Europe/London)\\nLength: 45 minutes\r\n',
    );
    expect(summer).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/);

    const winter = bookingCalendar(
      {
        ...booking,
        startsAt: new Date('2026-10-27T10:30:00Z'),
        endsAt: new Date('2026-10-27T11:30:00Z'),
        updatedAt: new Date('2026-10-21T08:00:00Z'),
        rescheduleCount: 1,
      },
      settings,
    ).replaceAll('\r\n ', '');
    expect(winter).toContain(`\r\nUID:${booking.id}@bookit.test\r\n`);
    expect(summer).toContain(`\r\nUID:${booking.id}@bookit.test\r\n`);
    expect(winter).toContain('\r\nDTSTAMP:20261021T080000Z\r\n');
    expect(winter).toContain('\r\nDTSTART:20261027T103000Z\r\nDTEND:20261027T113000Z\r\nSEQUENCE:1\r\n');
    expect(winter).toContain('Tue\\, 27 Oct 2026\\, 10:30 (Europe/London)\\nLength: 60 minutes');
  });

  it('preserves accented names and escapes text within folded calendar lines', () => {
    const name = `${'É'.repeat(45)}, Pat; Physio\\Clinic\r\nSUMMARY:Other`;
    const calendar = bookingCalendar({ ...booking, practitionerName: name }, settings);
    for (const line of calendar.split('\r\n')) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
    const unfolded = calendar.replaceAll('\r\n ', '');
    expect(unfolded).toContain(
      `\r\nSUMMARY:Acme Physio session with ${'É'.repeat(45)}\\, Pat\\; Physio\\\\Clinic\\nSUMMARY:Other\r\n`,
    );
    expect(unfolded.match(/^SUMMARY:/gm)).toHaveLength(1);
  });
});
