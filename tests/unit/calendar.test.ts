import { describe, expect, it, vi, beforeEach } from 'vitest';
import { bookingCalendar, calendarLinks } from '@/server/bookings/calendar';
import type { BookingView } from '@/server/bookings/queries';
import type { ClinicSettings } from '@/server/settings';

const booking: BookingView = {
  id: '019a0000-0000-7000-8000-00000000b001',
  patientId: 'patient-1',
  status: 'confirmed',
  lateCancellation: false,
  phone: '+44 7700 900001',
  rescheduleCount: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  cancelledAt: null,
  slotId: 'slot-1',
  startsAt: new Date('2026-07-22T08:00:00Z'),
  endsAt: new Date('2026-07-22T08:45:00Z'),
  practitionerId: 'practitioner-1',
  practitionerName: 'Alex Physiotherapist',
};
const settings: ClinicSettings = {
  clinicName: 'Acme Physio',
  timeZone: 'Europe/London',
  lateCancellationHours: 24,
  includeContactInConfirmation: true,
  slotHorizonDays: 220,
  sessionMinutes: 30,
  maxReschedulesPerBooking: 3,
};

const mocks = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn(), settings: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/server/request-context', () => ({ currentUser: mocks.user }));
vi.mock('@/server/bookings/queries', () => ({ findBookingForPatient: mocks.find }));
vi.mock('@/server/settings', () => ({ loadClinicSettings: mocks.settings }));
import { GET } from '@/app/bookings/[bookingId]/calendar/route';

function unfold(text: string) {
  return text.replace(/\r\n /g, '');
}

describe('appointment calendar', () => {
  it.each([
    ['2026-07-22T08:00:00Z', '09:00'],
    ['2026-12-22T08:00:00Z', '08:00'],
  ])('exports the actual slot length and correct UK time for %s', (start, localTime) => {
    const startsAt = new Date(start);
    const value = { ...booking, startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60_000) };
    const file = unfold(bookingCalendar(value, settings));
    expect(file).toContain(`DTSTART:${start.replace(/[-:]/g, '')}\r\n`);
    expect(file).toContain(`DTEND:${value.endsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}`);
    expect(file).toContain(`${localTime} (Europe/London)`);
    expect(file).toContain('Length: 45 minutes');
    expect(file).toContain('SUMMARY:Acme Physio appointment with Alex Physiotherapist');
    expect(file).toContain('LOCATION:Acme Physio');
    expect(file).not.toContain(booking.phone);
    const links = calendarLinks(value, settings);
    const google = new URL(links.google).searchParams;
    expect(google.get('dates')).toContain(start.replace(/[-:]/g, ''));
    expect(google.get('ctz')).toBe('Europe/London');
    const outlook = new URL(links.outlook).searchParams;
    expect(outlook.get('startdt')).toBe(startsAt.toISOString());
    expect(outlook.get('enddt')).toBe(value.endsAt.toISOString());
  });

  it('keeps the event identity and increases its version when an appointment moves', () => {
    const original = bookingCalendar(booking, settings);
    const moved = bookingCalendar(
      {
        ...booking,
        rescheduleCount: 1,
        startsAt: new Date('2026-07-23T09:00:00Z'),
        endsAt: new Date('2026-07-23T09:45:00Z'),
      },
      settings,
    );
    expect(original.match(/UID:.+/)?.[0]).toBe(moved.match(/UID:.+/)?.[0]);
    expect(moved).toContain('SEQUENCE:1\r\n');
    expect(moved).toContain('DTSTART:20260723T090000Z');
    expect(moved).not.toContain('DTSTART:20260722');
  });

  it('escapes calendar text and folds long Unicode lines without breaking characters', () => {
    const file = bookingCalendar(
      { ...booking, practitionerName: 'É'.repeat(90) },
      { ...settings, clinicName: 'Clinic, one; two\\three\nEND:VEVENT' },
    );
    expect(unfold(file)).toContain('LOCATION:Clinic\\, one\\; two\\\\three\\nEND:VEVENT\r\n');
    for (const line of file.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(unfold(file)).toContain('É'.repeat(90));
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('private calendar download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: booking.patientId, role: 'patient' });
    mocks.find.mockResolvedValue(booking);
    mocks.settings.mockResolvedValue(settings);
  });
  const download = () =>
    GET(new Request('http://localhost/bookings/id/calendar'), { params: Promise.resolve({ bookingId: booking.id }) });
  it('downloads only the signed-in client’s booking and prevents caching', async () => {
    const response = await download();
    expect(mocks.find).toHaveBeenCalledWith({}, booking.patientId, booking.id);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toContain('.ics');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe(bookingCalendar(booking, settings));
  });
  it('refuses a signed-out visitor or an administrator', async () => {
    for (const user of [null, { id: 'admin', role: 'admin' }]) {
      mocks.user.mockResolvedValue(user);
      expect((await download()).status).toBe(401);
    }
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('refuses missing, another client’s and cancelled bookings', async () => {
    for (const result of [null, { ...booking, status: 'cancelled' }]) {
      mocks.find.mockResolvedValue(result);
      expect((await download()).status).toBe(404);
    }
  });
});
