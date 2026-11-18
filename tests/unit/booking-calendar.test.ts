import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('booking calendar', () => {
  it('includes the clinic, practitioner, UK local date and time, and saved slot length in winter and summer', () => {
    for (const { tenant, clinicName, visit, role, startsAt, endsAt, utcStart, utcEnd, localStart, length } of [
      {
        tenant: 'acme',
        clinicName: 'Acme Physio',
        visit: 'session',
        role: 'physiotherapist',
        startsAt: '2026-12-01T09:00:00Z',
        endsAt: '2026-12-01T09:45:00Z',
        utcStart: '20261201T090000Z',
        utcEnd: '20261201T094500Z',
        localStart: 'Tue, 1 Dec 2026, 09:00',
        length: 45,
      },
      {
        tenant: 'beacon',
        clinicName: 'Beacon Dental',
        visit: 'appointment',
        role: 'clinician',
        startsAt: '2027-04-01T08:00:00Z',
        endsAt: '2027-04-01T08:30:00Z',
        utcStart: '20270401T080000Z',
        utcEnd: '20270401T083000Z',
        localStart: 'Thu, 1 Apr 2027, 09:00',
        length: 30,
      },
    ]) {
      vi.stubEnv('BOOKIT_TENANT', tenant);
      const calendar = bookingCalendar(
        {
          id: '019a0000-0000-7000-8000-00000000b001',
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          updatedAt: new Date('2026-10-20T07:00:00Z'),
          rescheduleCount: 0,
          practitionerName: 'Taylor Reed',
        },
        { clinicName, timeZone: 'Europe/London' },
      ).replace(/\r\n /g, '');

      expect(calendar).toContain(`SUMMARY:${clinicName} ${visit} with Taylor Reed\r\n`);
      expect(calendar).toContain(`LOCATION:${clinicName}\r\n`);
      expect(calendar).toContain(`DTSTART:${utcStart}\r\n`);
      expect(calendar).toContain(`DTEND:${utcEnd}\r\n`);
      expect(calendar).toContain(
        `DESCRIPTION:${localStart.replaceAll(',', '\\,')} (Europe/London)\\n${length} minutes\\nYour ${role} is Taylor Reed.\r\n`,
      );
    }
  });

  it('escapes calendar text and folds long lines without splitting UTF-8 characters', () => {
    vi.stubEnv('BOOKIT_TENANT', 'test');
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
      `SUMMARY:${'É'.repeat(40)} appointment with Zoë\\, née Léon\\; physio\\\\trainer\\nEast wing\r\n`,
    );
  });
});
