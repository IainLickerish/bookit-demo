import { describe, expect, it } from 'vitest';
import { bookingCalendar } from '@/server/bookings/calendar';
import type { BookingView } from '@/server/bookings/queries';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

const booking: BookingView = {
  id: '019a0000-0000-7000-8000-00000000b001',
  patientId: '019a0000-0000-7000-8000-00000000a001',
  status: 'confirmed',
  lateCancellation: false,
  phone: '+44 7700 900001',
  rescheduleCount: 0,
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  slotId: '019a0000-0000-7000-8000-00000000c001',
  startsAt: new Date('2026-10-22T09:30:00Z'),
  endsAt: new Date('2026-10-22T10:15:00Z'),
  practitionerId: '019a0000-0000-7000-8000-00000000d001',
  practitionerName: 'Pat Physio',
};

const unfold = (value: string) => value.replace(/\r\n /g, '');

describe('personal booking calendar files', () => {
  it.each([
    ['2026-10-22T09:30:00Z', '20261022T093000Z', 'Thu, 22 Oct 2026, 10:30'],
    ['2026-10-26T09:30:00Z', '20261026T093000Z', 'Mon, 26 Oct 2026, 09:30'],
    ['2027-03-29T08:30:00Z', '20270329T083000Z', 'Mon, 29 Mar 2027, 09:30'],
    ['2026-10-25T00:30:00Z', '20261025T003000Z', 'Sun, 25 Oct 2026, 01:30'],
    ['2027-03-28T00:30:00Z', '20270328T003000Z', 'Sun, 28 Mar 2027, 00:30'],
  ])('keeps the saved instant and actual duration through UK clock changes at %s', (iso, utc, local) => {
    const startsAt = new Date(iso);
    const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
    const file = unfold(
      bookingCalendar({ ...booking, startsAt, endsAt }, { ...TEST_CLINIC_SETTINGS, sessionMinutes: 90 }),
    );
    expect(file).toContain(`DTSTART:${utc}\r\n`);
    expect(file).toContain(`DTEND:${endsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}\r\n`);
    expect(file).toContain(`When: ${local.replaceAll(',', '\\,')} (Europe/London)`);
    expect(file).toContain('Duration: 45 minutes');
    expect(file).toContain('SUMMARY:Test Physio Clinic with Pat Physio\r\n');
    expect(file).toContain('LOCATION:Test Physio Clinic\r\n');
    expect(file).toContain('CLASS:PRIVATE\r\n');
    expect(file).not.toMatch(/7700|ATTENDEE|ORGANIZER|METHOD|patientId/);
    expect(file).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
    expect(file).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/);
  });

  it('escapes calendar syntax and folds long Unicode text without breaking UTF-8', () => {
    const clinicName = `Clinic, East; \\ North\r\nEND:VEVENT\n${'Zoë 🦷'.repeat(30)}`;
    const file = bookingCalendar(
      { ...booking, practitionerName: 'Niamh O’Connell' },
      { ...TEST_CLINIC_SETTINGS, clinicName },
    );
    for (const line of file.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(file.replaceAll('\r\n', '')).not.toMatch(/[\r\n\uFFFD]/);
    expect(unfold(file)).toContain(`LOCATION:Clinic\\, East\\; \\\\ North\\nEND:VEVENT\\n${'Zoë 🦷'.repeat(30)}\r\n`);
    expect(file.split('\r\n').filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(unfold(file)).toContain('Niamh O’Connell');
  });

  it('keeps the event identity and increases its revision after moving', () => {
    const original = bookingCalendar(booking, TEST_CLINIC_SETTINGS);
    const moved = bookingCalendar(
      { ...booking, rescheduleCount: 1, updatedAt: new Date('2026-10-21T12:00:00Z') },
      TEST_CLINIC_SETTINGS,
    );
    for (const file of [original, moved]) expect(file).toContain(`UID:${booking.id}@bookit.test\r\n`);
    expect(original).toContain('SEQUENCE:0\r\n');
    expect(moved).toContain('SEQUENCE:1\r\n');
    expect(moved).toContain('LAST-MODIFIED:20261021T120000Z\r\n');
  });
});
