import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookSlotPage from '@/app/book/[slotId]/page';
import ReschedulePage from '@/app/bookings/[bookingId]/reschedule/page';
import { BOOKING_ERRORS } from '@/server/bookings/errors';
import { findBookingForPatient, type BookingView } from '@/server/bookings/queries';
import { loadClinicSettings } from '@/server/settings';
import { loadDayView } from '@/server/slots/day-view';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/app/bookings/actions', () => ({ bookAction: vi.fn(), rescheduleAction: vi.fn() }));
vi.mock('@/server/request-context', () => ({
  requirePatient: async () => ({ id: 'patient', phone: null }),
}));
vi.mock('@/server/bookings/queries', () => ({ findBookingForPatient: vi.fn() }));
vi.mock('@/server/settings', () => ({ loadClinicSettings: vi.fn() }));
vi.mock('@/server/slots/day-view', () => ({ loadDayView: vi.fn() }));
vi.mock('@/server/slots/queries', () => ({ findBookableSlot: vi.fn(), isSlotFree: vi.fn() }));

const slot = {
  id: 'slot',
  practitionerId: 'practitioner',
  practitionerName: 'Pat Physio',
  startsAt: new Date('2026-11-20T13:00:00Z'),
  endsAt: new Date('2026-11-20T13:45:00Z'),
};
const booking: BookingView = {
  ...slot,
  id: 'booking',
  patientId: 'patient',
  status: 'confirmed',
  lateCancellation: false,
  phone: null,
  rescheduleCount: 0,
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  slotId: slot.id,
};

function expectRefusal(markup: string, message: string, detailId: string, detail: string) {
  expect(markup.match(/\srole="alert"/g)).toHaveLength(1);
  const alert = /<p\srole="alert"[^>]*\sdata-testid="booking-error"[^>]*>(.*?)<\/p>/s.exec(markup);
  expect(alert?.[1]).toContain(message);
  const explanation = new RegExp(`<p([^>]*)\\sdata-testid="${detailId}"([^>]*)>([^<]*)</p>`).exec(markup);
  expect(explanation?.[3]).toBe(detail);
  expect(explanation?.[1]).not.toMatch(/\balert\b/);
  expect(explanation?.[2]).not.toMatch(/\balert\b/);
}

describe('Booking page refusals', () => {
  beforeEach(() => {
    vi.mocked(loadClinicSettings).mockResolvedValue(TEST_CLINIC_SETTINGS);
  });

  it('shows one alert and keeps the taken-slot explanation and way back', async () => {
    vi.mocked(findBookableSlot).mockResolvedValue(slot);
    vi.mocked(isSlotFree).mockResolvedValue(false);

    const markup = renderToStaticMarkup(
      await BookSlotPage({
        params: Promise.resolve({ slotId: slot.id }),
        searchParams: Promise.resolve({ error: 'slot_unavailable' }),
      }),
    );

    expectRefusal(markup, BOOKING_ERRORS.slot_unavailable.message, 'slot-taken', 'This time is no longer available.');
    expect(markup).toMatch(/<a[^>]*href="\/slots"[^>]*>Choose a different time<\/a>/);
    expect(markup).not.toContain('data-testid="confirm-booking"');
  });

  it.each([
    {
      error: 'booking_not_active',
      booking: { ...booking, status: 'cancelled' },
      detailId: 'not-reschedulable',
      detail: 'This booking can no longer be rescheduled online.',
    },
    {
      error: 'reschedule_limit_reached',
      booking: { ...booking, rescheduleCount: TEST_CLINIC_SETTINGS.maxReschedulesPerBooking },
      detailId: 'reschedule-limit',
      detail: 'This booking has been rescheduled as many times as the clinic allows. Please contact the clinic.',
    },
  ] as const)('shows one alert and keeps the reschedule explanation for $error', async (scenario) => {
    vi.mocked(findBookingForPatient).mockResolvedValue(scenario.booking);
    vi.mocked(loadDayView).mockResolvedValue({
      settings: TEST_CLINIC_SETTINGS,
      practitioner: null,
      practitioners: [],
      date: '2026-11-20',
      today: '2026-10-20',
      lastDate: '2026-11-21',
      slots: [],
    });

    const markup = renderToStaticMarkup(
      await ReschedulePage({
        params: Promise.resolve({ bookingId: booking.id }),
        searchParams: Promise.resolve({ error: scenario.error }),
      }),
    );

    expectRefusal(markup, BOOKING_ERRORS[scenario.error].message, scenario.detailId, scenario.detail);
    expect(markup).toMatch(/<a[^>]*href="\/bookings"[^>]*>Back to my bookings<\/a>/);
  });
});
