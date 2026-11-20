import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import BookSlotPage from '@/app/book/[slotId]/page';
import { DayPicker } from '@/app/day-picker';
import SlotsPage from '@/app/slots/page';
import { loadClinicSettings } from '@/server/settings';
import { loadDayView, type DayView } from '@/server/slots/day-view';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';

vi.mock('@/app/bookings/actions', () => ({ bookAction: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/request-context', () => ({ requirePatient: vi.fn(() => ({ phone: null })) }));
vi.mock('@/server/settings', () => ({ loadClinicSettings: vi.fn() }));
vi.mock('@/server/slots/day-view', () => ({ loadDayView: vi.fn() }));
vi.mock('@/server/slots/queries', () => ({ findBookableSlot: vi.fn(), isSlotFree: vi.fn() }));

const practitioner = { id: 'alex', name: 'Alex Physiotherapist', bio: '' };
const morningSlot = {
  id: 'morning',
  practitionerId: practitioner.id,
  practitionerName: practitioner.name,
  startsAt: new Date('2026-10-22T09:30:00Z'),
  endsAt: new Date('2026-10-22T10:15:00Z'),
};
const view: DayView = {
  settings: {
    clinicName: 'Acme Physio',
    timeZone: 'Europe/London',
    lateCancellationHours: 24,
    includeContactInConfirmation: true,
    slotHorizonDays: 220,
    sessionMinutes: 45,
    maxReschedulesPerBooking: 3,
  },
  practitioner,
  practitioners: [practitioner],
  today: '2026-10-20',
  date: '2026-10-22',
  lastDate: '2027-05-28',
  slots: [morningSlot],
};

it('names the day shown and the dates on the previous and next day choices', async () => {
  vi.mocked(loadDayView).mockResolvedValue(view);
  const page = renderToStaticMarkup(await SlotsPage({ searchParams: Promise.resolve({ date: view.date }) }));

  expect(page).toMatch(/<h2[^>]*>Available times for <time[^>]*>Thursday, 22 October 2026<\/time><\/h2>/);
  expect(page).toMatch(
    /<a[^>]*href="\/slots\?practitioner=alex&amp;date=2026-10-21"[^>]*>Previous day<time[^>]*>Wednesday, 21 October 2026<\/time><\/a>/,
  );
  expect(page).toMatch(
    /<a[^>]*href="\/slots\?practitioner=alex&amp;date=2026-10-23"[^>]*>Next day<time[^>]*>Friday, 23 October 2026<\/time><\/a>/,
  );
});

it('links the clinic-local time to the review for that session', async () => {
  vi.mocked(loadDayView).mockResolvedValue(view);
  const page = renderToStaticMarkup(await SlotsPage({ searchParams: Promise.resolve({ date: view.date }) }));

  expect(page).toMatch(
    /<a[^>]*href="\/book\/morning"[^>]*><time dateTime="2026-10-22T09:30:00.000Z">Thu, 22 Oct 2026, 10:30<\/time><\/a>/,
  );
});

it('keeps the day controls used when moving a session', () => {
  const page = renderToStaticMarkup(DayPicker({ view, path: '/bookings/existing/reschedule' }));

  expect(page).toMatch(/<form[^>]*action="\/bookings\/existing\/reschedule"[^>]*method="get"/);
  expect(page).toContain('Practitioner<select');
  expect(page).toMatch(/<input[^>]*type="date"[^>]*name="date"[^>]*value="2026-10-22"/);
  expect(page).toMatch(/<button[^>]*type="submit"[^>]*>Show times<\/button>/);
  expect(page).toMatch(
    /<a[^>]*href="\/bookings\/existing\/reschedule\?practitioner=alex&amp;date=2026-10-21"[^>]*>← Previous day<\/a>/,
  );
  expect(page).toMatch(
    /<a[^>]*href="\/bookings\/existing\/reschedule\?practitioner=alex&amp;date=2026-10-23"[^>]*>Next day →<\/a>/,
  );
});

async function renderReview(free: boolean): Promise<string> {
  vi.mocked(loadClinicSettings).mockResolvedValue({ ...view.settings, sessionMinutes: 30 });
  vi.mocked(findBookableSlot).mockResolvedValue(morningSlot);
  vi.mocked(isSlotFree).mockResolvedValue(free);
  return renderToStaticMarkup(
    await BookSlotPage({ params: Promise.resolve({ slotId: morningSlot.id }), searchParams: Promise.resolve({}) }),
  );
}

it('lists the physiotherapist, clinic-local date and time, and session length before confirmation', async () => {
  const page = await renderReview(true);

  expect(page).toMatch(/<dt[^>]*>Physiotherapist<\/dt><dd[^>]*>Alex Physiotherapist<\/dd>/);
  expect(page).toMatch(/<dt[^>]*>Date and time<\/dt><dd[^>]*><time[^>]*>Thu, 22 Oct 2026, 10:30<\/time><\/dd>/);
  expect(page).toMatch(/<dt[^>]*>Duration<\/dt><dd[^>]*>30 minutes<\/dd>/);
  expect(page.indexOf('30 minutes')).toBeLessThan(page.indexOf('Confirm booking'));
  expect(page).toMatch(/<label[^>]*>Phone number \(optional\)<input[^>]*name="phone"/);
  expect(page).toMatch(/<input[^>]*type="hidden"[^>]*name="slotId"[^>]*value="morning"/);
  expect(page).toMatch(/<button[^>]*type="submit"[^>]*>Confirm booking<\/button>/);
});

it('links back to Book when a time is no longer available', async () => {
  const page = await renderReview(false);

  expect(page).toContain('This time is no longer available.');
  expect(page).not.toContain('Confirm booking');
  expect(page).toMatch(/<a[^>]*href="\/slots"[^>]*>Choose a different time<\/a>/);
});
