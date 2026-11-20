import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { DayPicker } from '@/app/day-picker';
import SlotsPage from '@/app/slots/page';
import { loadDayView, type DayView } from '@/server/slots/day-view';

vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/request-context', () => ({ requirePatient: vi.fn() }));
vi.mock('@/server/slots/day-view', () => ({ loadDayView: vi.fn() }));

const practitioner = { id: 'alex', name: 'Alex Physiotherapist', bio: '' };
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
  slots: [
    {
      id: 'morning',
      practitionerId: practitioner.id,
      practitionerName: practitioner.name,
      startsAt: new Date('2026-10-22T09:30:00Z'),
      endsAt: new Date('2026-10-22T10:15:00Z'),
    },
  ],
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

it('takes clients from a clinic-local time choice to the review for that session', async () => {
  vi.mocked(loadDayView).mockResolvedValue(view);
  const page = renderToStaticMarkup(await SlotsPage({ searchParams: Promise.resolve({ date: view.date }) }));

  expect(page).toMatch(
    /<a[^>]*href="\/book\/morning"[^>]*><time dateTime="2026-10-22T09:30:00.000Z">Thu, 22 Oct 2026, 10:30<\/time><\/a>/,
  );
});

it('keeps the day controls used when moving a session', () => {
  const page = renderToStaticMarkup(DayPicker({ view, path: '/bookings/existing/reschedule' }));

  expect(page).toContain('Practitioner<select');
  expect(page).toMatch(
    /<a[^>]*href="\/bookings\/existing\/reschedule\?practitioner=alex&amp;date=2026-10-21"[^>]*>← Previous day<\/a>/,
  );
  expect(page).toMatch(
    /<a[^>]*href="\/bookings\/existing\/reschedule\?practitioner=alex&amp;date=2026-10-23"[^>]*>Next day →<\/a>/,
  );
});
