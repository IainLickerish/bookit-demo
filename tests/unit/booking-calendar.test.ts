import { describe, expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';

describe('booking calendar', () => {
  it('includes the clinic, practitioner, UK local date and time, and saved slot length in winter and summer', () => {
    const clinic = { clinicName: 'Acme Physio', timeZone: 'Europe/London' };
    for (const [startsAt, endsAt, utcStart, utcEnd, localStart, length] of [
      [
        '2026-12-01T09:00:00Z',
        '2026-12-01T09:45:00Z',
        '20261201T090000Z',
        '20261201T094500Z',
        'Tue, 1 Dec 2026, 09:00',
        45,
      ],
      [
        '2027-04-01T08:00:00Z',
        '2027-04-01T08:30:00Z',
        '20270401T080000Z',
        '20270401T083000Z',
        'Thu, 1 Apr 2027, 09:00',
        30,
      ],
    ] as const) {
      const calendar = bookingCalendar(
        {
          id: '019a0000-0000-7000-8000-00000000b001',
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          updatedAt: new Date('2026-10-20T07:00:00Z'),
          rescheduleCount: 0,
          practitionerName: 'Alex Physio',
        },
        clinic,
      ).replace(/\r\n /g, '');

      expect(calendar).toContain('SUMMARY:Acme Physio with Alex Physio\r\n');
      expect(calendar).toContain('LOCATION:Acme Physio\r\n');
      expect(calendar).toContain(`DTSTART:${utcStart}\r\n`);
      expect(calendar).toContain(`DTEND:${utcEnd}\r\n`);
      expect(calendar).toContain(
        `DESCRIPTION:${localStart.replaceAll(',', '\\,')} (Europe/London)\\n${length} minutes\r\n`,
      );
    }
  });

  it('escapes calendar text and folds long lines without splitting UTF-8 characters', () => {
    const startsAt = new Date('2026-12-01T09:00:00Z');
    const calendar = bookingCalendar(
      {
        id: '019a0000-0000-7000-8000-00000000b001',
        startsAt,
        endsAt: new Date('2026-12-01T09:45:00Z'),
        updatedAt: startsAt,
        rescheduleCount: 0,
        practitionerName: 'Zoë, née Léon; physio\\trainer\nEast wing',
      },
      { clinicName: 'É'.repeat(40), timeZone: 'Europe/London' },
    );

    const lines = calendar.split('\r\n');
    expect(lines.every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(lines.some((line) => line.startsWith(' '))).toBe(true);
    expect(calendar.replace(/\r\n /g, '')).toContain(
      `SUMMARY:${'É'.repeat(40)} with Zoë\\, née Léon\\; physio\\\\trainer\\nEast wing\r\n`,
    );
  });
});
