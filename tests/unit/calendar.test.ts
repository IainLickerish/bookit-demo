import { describe, expect, it } from 'vitest';
import { calendarDetails } from '@/lib/calendar';

describe('calendar details', () => {
  it.each([
    ['2026-12-08T11:15:00Z', '2026-12-08T12:00:00Z', 'Tue, 8 Dec 2026, 11:15', 'Tue, 8 Dec 2026, 12:00', 'GMT'],
    ['2027-06-08T10:15:00Z', '2027-06-08T11:00:00Z', 'Tue, 8 Jun 2027, 11:15', 'Tue, 8 Jun 2027, 12:00', 'BST'],
  ])('uses the saved instants in UK time for %s', (start, end, startLabel, endLabel, zone) => {
    expect(
      calendarDetails({
        clinicName: 'Acme Physio',
        timeZone: 'Europe/London',
        practitionerName: 'Alex Physiotherapist',
        startsAt: new Date(start!),
        endsAt: new Date(end!),
      }),
    ).toBe(
      `Title: Acme Physio with Alex Physiotherapist\nClinic: Acme Physio\nWith: Alex Physiotherapist\nStart: ${startLabel}\nEnd: ${endLabel}\nTime zone: Europe/London (${zone})\nDuration: 45 minutes`,
    );
  });

  it('uses the stored duration, includes an end date across midnight and leaves out extra private fields', () => {
    const stored = {
      clinicName: 'Beacon Dental',
      timeZone: 'Europe/London',
      practitionerName: 'Blair Dentist',
      startsAt: new Date('2026-12-08T23:45:00Z'),
      endsAt: new Date('2026-12-09T00:15:00Z'),
      phone: '+44 7700 900123',
      email: 'client@beacon.test',
      name: 'Private Client',
      id: 'private-booking-id',
      privateLink: '/auth/reset-password/private-token',
      sessionMinutes: 45,
    };
    const details = calendarDetails(stored);
    expect(details).toContain('Title: Beacon Dental with Blair Dentist');
    expect(details).toContain('End: Wed, 9 Dec 2026, 00:15');
    expect(details).toContain('Duration: 30 minutes');
    for (const privateValue of [stored.phone, stored.email, stored.name, stored.id, stored.privateLink]) {
      expect(details).not.toContain(privateValue);
    }
  });

  it('calculates elapsed duration correctly across the spring clock change', () => {
    const details = calendarDetails({
      clinicName: 'Acme Physio',
      timeZone: 'Europe/London',
      practitionerName: 'Alex Physiotherapist',
      startsAt: new Date('2027-03-28T00:45:00Z'),
      endsAt: new Date('2027-03-28T01:30:00Z'),
    });
    expect(details).toContain('Start: Sun, 28 Mar 2027, 00:45');
    expect(details).toContain('End: Sun, 28 Mar 2027, 02:30');
    expect(details).toContain('Duration: 45 minutes');
  });
});
