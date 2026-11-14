import { describe, expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';
import { composeConfirmation } from '@/server/notifications/confirmation';
import { loadTenant } from '@/server/seed/tenant';
import { formatSlot } from '@/lib/time';
import { bookingView } from '../helpers/booking';

const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('calendar imports', () => {
  it.each(['acme', 'beacon'] as const)('includes %s clinic, practitioner and actual slot length', (tenant) => {
    const { settings } = loadTenant(tenant);
    // Deliberately differs from today's configured session length.
    const booking = bookingView({ endsAt: new Date('2026-10-22T12:30:00Z') });
    const text = unfold(bookingCalendar(booking, settings));
    expect(text).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    expect(text).toContain('BEGIN:VEVENT\r\n');
    expect(text).toContain(`SUMMARY:${settings.clinicName} with Pat Physio\r\n`);
    expect(text).toContain(`LOCATION:${settings.clinicName}\r\n`);
    expect(text).toContain('DTSTART:20261022T093000Z\r\nDTEND:20261022T123000Z\r\n');
    expect(text).toContain('Duration: 180 minutes');
    expect(text).toContain('STATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  });

  it.each([
    ['2026-10-24T08:00:00Z', 'Sat, 24 Oct 2026, 09:00'],
    ['2026-10-26T09:00:00Z', 'Mon, 26 Oct 2026, 09:00'],
    ['2027-03-27T09:00:00Z', 'Sat, 27 Mar 2027, 09:00'],
    ['2027-03-29T08:00:00Z', 'Mon, 29 Mar 2027, 09:00'],
    ['2026-10-25T00:30:00Z', 'Sun, 25 Oct 2026, 01:30'],
    ['2026-10-25T01:30:00Z', 'Sun, 25 Oct 2026, 01:30'],
  ])('keeps the instant %s and its correct UK time', (start, when) => {
    const booking = bookingView({
      startsAt: new Date(start),
      endsAt: new Date(Date.parse(start) + 45 * 60_000),
    });
    const text = unfold(bookingCalendar(booking, loadTenant('acme').settings));
    const match = /DTSTART:(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/.exec(text)!;
    const imported = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    expect(imported.toISOString()).toBe(booking.startsAt.toISOString());
    expect(formatSlot(imported, 'Europe/London')).toBe(when);
    expect(text).toContain(when.replace(/,/g, '\\,'));
  });

  it('keeps the event identity on a move and increases its sequence', () => {
    const original = bookingView();
    const moved = bookingView({
      startsAt: new Date('2026-10-27T09:00:00Z'),
      endsAt: new Date('2026-10-27T09:45:00Z'),
      updatedAt: new Date('2026-10-20T08:00:00Z'),
      rescheduleCount: 1,
    });
    const settings = loadTenant('acme').settings;
    const first = bookingCalendar(original, settings);
    const second = bookingCalendar(moved, settings);
    expect(first.match(/UID:.+/)?.[0]).toBe(second.match(/UID:.+/)?.[0]);
    expect(first).toContain('SEQUENCE:0\r\n');
    expect(second).toContain('SEQUENCE:1\r\n');
    expect(second).toContain('LAST-MODIFIED:20261020T080000Z\r\n');
    expect(second).toContain('DTSTART:20261027T090000Z\r\n');
  });

  it('escapes text, prevents injected calendar properties and folds UTF-8 without splitting characters', () => {
    const name = `Zoë, O’Connell; \\${'é🦷'.repeat(40)}\r\nEND:VEVENT\rATTENDEE:private@clinic.test`;
    const calendar = bookingCalendar(bookingView({ practitionerName: name }), {
      ...loadTenant('acme').settings,
      clinicName: 'Clinic, One; \\North\nSide',
    });
    for (const line of calendar.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(calendar).not.toContain('\uFFFD');
    const text = unfold(calendar);
    expect(text).toContain('Clinic\\, One\\; \\\\North\\nSide');
    expect(text).toContain('Zoë\\, O’Connell\\; \\\\');
    expect(text).not.toContain('\r\nATTENDEE:');
    expect(text.match(/^END:VEVENT$/gm)).toHaveLength(1);
  });

  it('attaches the same import to booking and move emails without patient data in the file', () => {
    const booking = bookingView({ phone: '+44 7700 900123' });
    const settings = loadTenant('beacon').settings;
    const patient = { name: 'Calendar Client', email: 'calendar@patients.example.test' };
    for (const moved of [false, true]) {
      const email = composeConfirmation({ booking, settings, patient, moved, from: 'noreply@clinic.test' });
      expect(email.attachments).toEqual([
        {
          filename: 'booking.ics',
          contentType: 'text/calendar; charset=utf-8',
          content: bookingCalendar(booking, settings),
        },
      ]);
      expect(email.text).toContain('Duration: 45 minutes');
      expect(email.text.startsWith(`${settings.clinicName}\n`)).toBe(true);
      expect(email.subject).toMatch(moved ? /^Booking moved:/ : /^Booking confirmed:/);
      expect(email.attachments![0]!.content).not.toMatch(/900123|Calendar Client|calendar@|ATTENDEE|ORGANIZER|METHOD:/);
    }
  });
});
