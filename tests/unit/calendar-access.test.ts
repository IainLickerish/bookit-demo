import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from '@/app/bookings/[bookingId]/calendar/page';
import { getDatabase } from '@/db/client';
import { findBookingForPatient, type BookingView } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import type { PublicUser } from '@/server/users';

vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/bookings/queries', () => ({ findBookingForPatient: vi.fn() }));
vi.mock('@/server/request-context', () => ({ requirePatient: vi.fn() }));
vi.mock('@/server/settings', () => ({ loadClinicSettings: vi.fn() }));

const patient = {
  id: '019a0000-0000-7000-8000-00000000a001',
  role: 'patient',
  name: 'Private Client',
  email: 'client@acme.test',
  phone: '+44 7700 900123',
} satisfies PublicUser;

const booking: BookingView = {
  id: '019a0000-0000-7000-8000-00000000b001',
  patientId: patient.id,
  status: 'confirmed',
  lateCancellation: false,
  phone: patient.phone,
  rescheduleCount: 0,
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  slotId: '019a0000-0000-7000-8000-00000000c001',
  startsAt: new Date('2026-12-08T11:15:00Z'),
  endsAt: new Date('2026-12-08T12:00:00Z'),
  practitionerId: '019a0000-0000-7000-8000-00000000d001',
  practitionerName: 'Alex Physiotherapist',
};

const page = () => CalendarPage({ params: Promise.resolve({ bookingId: booking.id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePatient).mockResolvedValue(patient);
  vi.mocked(findBookingForPatient).mockResolvedValue(booking);
  vi.mocked(loadClinicSettings).mockResolvedValue({
    clinicName: 'Acme Physio',
    timeZone: 'Europe/London',
    lateCancellationHours: 24,
    includeContactInConfirmation: true,
    slotHorizonDays: 220,
    sessionMinutes: 45,
    maxReschedulesPerBooking: 3,
  });
});

describe('private calendar page', () => {
  it('queries only the signed-in client’s booking and renders no personal details or private links', async () => {
    const html = renderToStaticMarkup(await page());
    expect(findBookingForPatient).toHaveBeenCalledWith(getDatabase(), patient.id, booking.id);
    expect(html).toContain('Start: Tue, 8 Dec 2026, 11:15');
    expect(html).toContain('Duration: 45 minutes');
    for (const value of [patient.name, patient.email, patient.phone, booking.id, '/auth/reset-password']) {
      expect(html).not.toContain(value);
    }
  });

  it('returns not found when the patient-scoped query finds no booking', async () => {
    vi.mocked(findBookingForPatient).mockResolvedValue(null);
    await expect(page()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(findBookingForPatient).toHaveBeenCalledWith(getDatabase(), patient.id, booking.id);
  });

  it.each([
    { ...booking, status: 'cancelled' as const },
    { ...booking, startsAt: new Date('2026-10-20T06:00:00Z') },
    { ...booking, startsAt: new Date('2026-10-20T07:00:00Z') },
  ])('returns not found for an unavailable calendar summary: $status at $startsAt', async (unavailable) => {
    vi.mocked(findBookingForPatient).mockResolvedValue(unavailable);
    await expect(page()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('does not read bookings when patient authentication refuses access', async () => {
    const refused = new Error('Redirect to sign in');
    vi.mocked(requirePatient).mockRejectedValue(refused);
    await expect(page()).rejects.toBe(refused);
    expect(findBookingForPatient).not.toHaveBeenCalled();
    expect(loadClinicSettings).not.toHaveBeenCalled();
  });
});
