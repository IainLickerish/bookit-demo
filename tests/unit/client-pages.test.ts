import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyBookingsPage from '@/app/bookings/page';
import BookSlotPage from '@/app/book/[slotId]/page';
import ReschedulePage from '@/app/bookings/[bookingId]/reschedule/page';
import SlotsPage from '@/app/slots/page';
import { DayPicker } from '@/app/day-picker';
import { loadTenant } from '@/server/seed/tenant';
import { findBookingForPatient, listBookingsForPatient, type BookingView } from '@/server/bookings/queries';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { loadDayView, type DayView } from '@/server/slots/day-view';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/server/request-context', () => ({ requirePatient: vi.fn() }));
vi.mock('@/server/bookings/queries', () => ({ listBookingsForPatient: vi.fn(), findBookingForPatient: vi.fn() }));
vi.mock('@/server/slots/queries', () => ({ findBookableSlot: vi.fn(), isSlotFree: vi.fn() }));
vi.mock('@/server/slots/day-view', () => ({ loadDayView: vi.fn() }));
vi.mock('@/server/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/settings')>()),
  loadClinicSettings: vi.fn(),
}));
vi.mock('@/app/bookings/actions', () => ({ cancelAction: vi.fn(), bookAction: vi.fn(), rescheduleAction: vi.fn() }));

const patient = {
  id: 'design-client',
  email: 'design@bookit.test',
  name: 'Design Client',
  role: 'patient' as const,
  phone: null,
};
const booking: BookingView = {
  id: 'design-booking',
  patientId: patient.id,
  practitionerId: 'design-practitioner',
  practitionerName: 'Fictional Practitioner',
  slotId: 'design-slot',
  startsAt: new Date('2026-11-25T09:00:00Z'),
  endsAt: new Date('2026-11-25T09:45:00Z'),
  status: 'confirmed',
  phone: null,
  lateCancellation: false,
  rescheduleCount: 0,
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
};

describe.each(['acme', 'beacon'] as const)('%s client page states', (tenantName) => {
  let day: DayView;
  beforeEach(() => {
    vi.resetAllMocks();
    const settings = loadTenant(tenantName).settings;
    day = {
      settings,
      practitioners: [{ id: booking.practitionerId, name: booking.practitionerName, bio: '' }],
      practitioner: { id: booking.practitionerId, name: booking.practitionerName, bio: '' },
      today: '2026-10-20',
      date: '2026-11-25',
      lastDate: '2027-05-28',
      slots: [],
    };
    vi.mocked(requirePatient).mockResolvedValue(patient);
    vi.mocked(loadClinicSettings).mockResolvedValue(settings);
    vi.mocked(loadDayView).mockResolvedValue(day);
    vi.mocked(listBookingsForPatient).mockResolvedValue([]);
    vi.mocked(findBookingForPatient).mockResolvedValue(booking);
    vi.mocked(findBookableSlot).mockResolvedValue({
      id: booking.slotId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      practitionerId: booking.practitionerId,
      practitionerName: booking.practitionerName,
    });
    vi.mocked(isSlotFree).mockResolvedValue(true);
  });

  it('keeps the empty My bookings message and booking link inside the shared card style', async () => {
    const html = renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve({}) }));
    expect(requirePatient).toHaveBeenCalledOnce();
    expect(listBookingsForPatient).toHaveBeenCalledWith({}, patient.id);
    expect(html).toContain('You have no upcoming appointments.');
    expect(html).toMatch(/<p class="card empty-state"[^>]*data-testid="no-upcoming"/);
    expect(html).toMatch(/<a[^>]*href="\/slots"[^>]*>Book one</);
  });

  it('keeps the no-times message and day navigation available in the empty availability state', async () => {
    const html = renderToStaticMarkup(await SlotsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('No free times on this day. Try another day.');
    expect(html).toContain('data-testid="day-picker"');
    expect(html).toContain('data-testid="previous-day"');
    expect(html).toContain('data-testid="next-day"');
    expect(html).toContain('data-testid="show-slots"');
  });

  it('keeps the unavailable-time refusal and back link without an active booking action', async () => {
    vi.mocked(isSlotFree).mockResolvedValue(false);
    const html = renderToStaticMarkup(
      await BookSlotPage({ params: Promise.resolve({ slotId: booking.slotId }), searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('This time is no longer available.');
    expect(html).toContain('Choose a different time');
    expect(html).not.toContain('data-testid="confirm-booking"');
    expect(html).not.toContain('has-booking-action');
  });

  it.each(['cancelled', 'move-limit'] as const)(
    'keeps %s move refusals without offering time actions',
    async (state) => {
      vi.mocked(findBookingForPatient).mockResolvedValue({
        ...booking,
        ...(state === 'cancelled'
          ? { status: 'cancelled' as const }
          : { rescheduleCount: day.settings.maxReschedulesPerBooking }),
      });
      const html = renderToStaticMarkup(
        await ReschedulePage({ params: Promise.resolve({ bookingId: booking.id }), searchParams: Promise.resolve({}) }),
      );
      expect(findBookingForPatient).toHaveBeenCalledWith({}, patient.id, booking.id);
      expect(html).toContain(
        state === 'cancelled'
          ? 'This booking can no longer be rescheduled online.'
          : 'This booking has been rescheduled as many times as the clinic allows. Please contact the clinic.',
      );
      expect(html).toContain('Back to my bookings');
      expect(html).not.toContain('data-testid="reschedule-to"');
      expect(html).not.toContain('data-testid="day-picker"');
      expect(html).not.toContain('has-booking-action');
    },
  );

  it('keeps previous and next day boundaries without adding a new day choice', () => {
    const start = renderToStaticMarkup(createElement(DayPicker, { view: { ...day, date: day.today }, path: '/slots' }));
    const end = renderToStaticMarkup(
      createElement(DayPicker, { view: { ...day, date: day.lastDate }, path: '/slots' }),
    );
    expect(start).not.toContain('data-testid="previous-day"');
    expect(start).toContain('data-testid="next-day"');
    expect(end).toContain('data-testid="previous-day"');
    expect(end).not.toContain('data-testid="next-day"');
  });
});
