import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { bookAction, rescheduleAction } from '@/app/bookings/actions';
import MyBookingsPage from '@/app/bookings/page';
import { getDatabase } from '@/db/client';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { bookingDependencies, currentUser, requirePatient } from '@/server/request-context';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('@/server/request-context', () => ({
  requirePatient: vi.fn(),
  currentUser: vi.fn(),
  bookingDependencies: vi.fn(),
}));

const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
let clinic: SeededClinic;
let deps: BookingDependencies;
let slotIds: string[];

beforeAll(async () => {
  database = await startTestDatabase();
  vi.mocked(getDatabase).mockReturnValue(database.db);
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { clinicName: 'Acme Physio' } });
  deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
  vi.mocked(bookingDependencies).mockResolvedValue(deps);
  vi.mocked(requirePatient).mockResolvedValue(clinic.patient1);
  const slots = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: new Date('2026-10-22T00:00:00Z'),
  });
  slotIds = slots.map((slot) => slot.id);
});

async function followBookingRedirect(action: (form: FormData) => Promise<void>, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  try {
    await action(form);
  } catch (error) {
    // Next.js throws a redirect from a form action so it can send the client to the result.
    const digest = (error as { digest?: string }).digest;
    if (digest?.startsWith('NEXT_REDIRECT;')) {
      const url = new URL(digest.split(';')[2]!, 'https://bookit.test');
      expect(url.pathname).toBe('/bookings');
      return Object.fromEntries(url.searchParams);
    }
    throw error;
  }
  throw new Error('Expected the booking action to redirect.');
}

async function bookingsPage(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve(query) }));
}

it('offers the saved session calendar on both booking and move confirmations', async () => {
  const other = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slotIds[0]! });
  const booked = await followBookingRedirect(bookAction, { slotId: slotIds[1]! });
  expect(booked.booking).toBeTruthy();
  expect(booked.booking).not.toBe(other.id);
  const calendarHref = `href="/bookings/${booked.booking}/calendar"`;
  const confirmationLink = new RegExp(`${calendarHref}[^>]*data-testid="confirmation-calendar"`);
  const confirmation = await bookingsPage(booked);
  expect(confirmation).toContain('Booking confirmed.');
  expect(confirmation).toMatch(confirmationLink);

  const moved = await followBookingRedirect(rescheduleAction, { bookingId: booked.booking!, newSlotId: slotIds[2]! });
  const moveConfirmation = await bookingsPage(moved);
  expect(moveConfirmation).toContain('Booking rescheduled.');
  expect(moveConfirmation).toMatch(confirmationLink);
});

it('lists a calendar link for each of the client’s sessions in My bookings', async () => {
  const owned = await Promise.all(
    slotIds.slice(0, 2).map((slotId) => bookSlot(deps, { patientId: clinic.patient1.id, slotId })),
  );
  const other = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: slotIds[2]! });
  const cancelled = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slotIds.at(-1)! });
  await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: cancelled.id });

  const html = await bookingsPage({ notice: 'booked', booking: other.id });
  expect([...html.matchAll(/data-testid="booking-calendar"/g)]).toHaveLength(2);
  for (const booking of owned) {
    expect(html).toContain(`href="/bookings/${booking.id}/calendar"`);
  }
  expect(html).not.toContain('data-testid="confirmation-calendar"');
  expect(html).not.toContain(`/bookings/${other.id}/calendar`);
  expect(html).not.toContain(`/bookings/${cancelled.id}/calendar`);
});

it('only downloads the current calendar file for the patient who owns a confirmed session', async () => {
  const { GET } = await import('@/app/bookings/[bookingId]/calendar/route');
  const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slotIds.at(-1)! });
  const download = (bookingId = booking.id) =>
    GET(new Request(`https://bookit.test/bookings/${bookingId}/calendar`), {
      params: Promise.resolve({ bookingId }),
    });

  vi.mocked(currentUser).mockResolvedValue(null);
  expect((await download()).status).toBe(401);
  vi.mocked(currentUser).mockResolvedValue(clinic.admin);
  expect((await download()).status).toBe(403);
  vi.mocked(currentUser).mockResolvedValue(clinic.patient2);
  expect((await download()).status).toBe(404);
  vi.mocked(currentUser).mockResolvedValue(clinic.patient1);
  expect((await download('not-a-booking-id')).status).toBe(404);

  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="session.ics"');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const file = await response.text();
  expect(file).toContain('SUMMARY:Acme Physio: session with Pat Physio\r\n');
  expect(file).toContain('DTSTART:20261021T144500Z\r\n');
  expect(file).toContain('DTEND:20261021T153000Z\r\n');
  expect(file).not.toMatch(/Patient One|@patients\.example\.test|7700/);

  await rescheduleBooking(deps, {
    patientId: clinic.patient1.id,
    bookingId: booking.id,
    newSlotId: slotIds.at(-2)!,
  });
  const updated = await (await download()).text();
  expect(updated).toContain('DTSTART:20261021T140000Z\r\n');
  expect(updated).toContain('DTEND:20261021T144500Z\r\n');

  await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
  expect((await download()).status).toBe(404);
});
