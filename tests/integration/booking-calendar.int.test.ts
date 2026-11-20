import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/bookings/[bookingId]/calendar/route';
import { bookAction, rescheduleAction } from '@/app/bookings/actions';
import MyBookingsPage from '@/app/bookings/page';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { listBookingsForPatient } from '@/server/bookings/queries';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
let clinic: SeededClinic;
let sessionToken: string | undefined;

vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));
vi.mock('@/lib/clock', () => ({ getClock: () => clock }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === SESSION_COOKIE ? { value: sessionToken } : undefined) }),
  headers: async () => new Headers(),
}));

class Redirect extends Error {}
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

function deps() {
  return { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
}

async function signIn(patientId: string) {
  sessionToken = (await createSession(database.db, clock, patientId)).token;
}

async function freeSlots() {
  return listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T07:00:00Z'),
    until: new Date('2026-10-22T16:00:00Z'),
  });
}

async function followBookingAction(action: (form: FormData) => Promise<void>, values: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  try {
    await action(form);
  } catch (error) {
    if (!(error instanceof Redirect)) throw error;
    const url = new URL(error.message, 'https://bookit.test');
    expect(url.pathname).toBe('/bookings');
    return renderToStaticMarkup(
      await MyBookingsPage({ searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) }),
    );
  }
  throw new Error('Expected the booking action to redirect.');
}

function confirmationDownload(markup: string) {
  return markup.match(
    /<a href="([^"]+)"[^>]*data-testid="add-to-calendar-confirmation"[^>]*>Add to calendar<\/a>/,
  )?.[1];
}

function downloadCalendar(bookingId: string) {
  return GET(new Request(`https://bookit.test/bookings/${bookingId}/calendar`), {
    params: Promise.resolve({ bookingId }),
  });
}

beforeAll(async () => {
  database = await startTestDatabase(5);
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  await signIn(clinic.patient1.id);
});

it('links to the saved session from both booking and move confirmations', async () => {
  const [otherSlot, originalSlot, targetSlot] = await freeSlots();
  await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: otherSlot!.id });

  const booked = await followBookingAction(bookAction, { slotId: originalSlot!.id });
  expect(booked).toContain('Booking confirmed.');
  const bookings = await listBookingsForPatient(database.db, clinic.patient1.id);
  const bookingId = bookings.find((booking) => booking.slotId === originalSlot!.id)!.id;
  const download = `/bookings/${bookingId}/calendar`;
  expect(confirmationDownload(booked)).toBe(download);
  const original = await downloadCalendar(bookingId);
  expect(original.status).toBe(200);
  expect(original.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
  expect(original.headers.get('Content-Disposition')).toBe('attachment; filename="session.ics"');
  expect(original.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await original.text()).toContain('DTSTART:20261022T084500Z');

  const moved = await followBookingAction(rescheduleAction, { bookingId, newSlotId: targetSlot!.id });
  expect(moved).toContain('Booking rescheduled.');
  expect(confirmationDownload(moved)).toBe(download);
  const updated = await downloadCalendar(bookingId);
  expect(updated.status).toBe(200);
  expect(await updated.text()).toContain('DTSTART:20261022T093000Z');
});

it('offers calendar downloads for each upcoming confirmed session in My bookings', async () => {
  const [pastSlot, firstSlot, secondSlot, cancelledSlot, otherSlot] = await freeSlots();
  const first = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: firstSlot!.id });
  const second = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: secondSlot!.id });
  const past = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: pastSlot!.id });
  const other = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: otherSlot!.id });
  const cancelled = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: cancelledSlot!.id });
  await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: cancelled.id });
  clock.set('2026-10-22T08:15:00Z');
  await signIn(clinic.patient1.id);

  const markup = renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve({}) }));
  const downloads = [
    ...markup.matchAll(/<a href="([^"]+)"[^>]*data-testid="add-to-calendar"[^>]*>Add to calendar<\/a>/g),
  ];
  expect(downloads.map((link) => link[1])).toEqual([
    `/bookings/${first.id}/calendar`,
    `/bookings/${second.id}/calendar`,
  ]);
  for (const id of [past.id, cancelled.id, other.id, 'bad-id']) {
    expect((await downloadCalendar(id)).status).toBe(404);
  }
  const foreignConfirmation = renderToStaticMarkup(
    await MyBookingsPage({ searchParams: Promise.resolve({ notice: 'booked', booking: other.id }) }),
  );
  expect(confirmationDownload(foreignConfirmation)).toBeUndefined();

  await signIn(clinic.admin.id);
  await expect(downloadCalendar(first.id)).rejects.toThrow(new Redirect('/'));
  sessionToken = undefined;
  await expect(downloadCalendar(first.id)).rejects.toThrow(new Redirect('/auth/sign-in'));
});
