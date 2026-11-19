import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { bookAction, rescheduleAction } from '@/app/bookings/actions';
import MyBookingsPage from '@/app/bookings/page';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { listBookingsForPatient } from '@/server/bookings/queries';
import { listAvailableSlots, type SlotView } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
let slotChoices: SlotView[];
let sessionToken: string | undefined;
const clock = manualClock('2026-10-20T07:00:00Z');

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE && sessionToken ? { name, value: sessionToken } : undefined),
  }),
  headers: async () => new Headers(),
}));

vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));

vi.mock('@/lib/clock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));

vi.mock('@/server/notifications/mailer', async (importOriginal) => {
  const mailer = await importOriginal<typeof import('@/server/notifications/mailer')>();
  return { ...mailer, getMailer: () => mailer.disabledMailer };
});

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  sessionToken = undefined;
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { clinicName: 'Acme Physio' } });
  slotChoices = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T07:59:00Z'),
    until: new Date('2026-10-22T15:00:00Z'),
  });
});

async function signIn(patientId: string) {
  sessionToken = (await createSession(database.db, clock, patientId)).token;
}

async function confirmationFrom(action: (form: FormData) => Promise<void>, fields: Record<string, string>) {
  const form = new FormData();
  Object.entries(fields).forEach(([name, value]) => form.set(name, value));
  const result: unknown = await action(form).catch((error: unknown) => error);
  expect(result).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;[^;]+;\/bookings\?[^;]+;/) });
  const destination = (result as { digest: string }).digest.split(';')[2]!;
  const query = new URLSearchParams(destination.split('?')[1]);
  return renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve(Object.fromEntries(query)) }));
}

function calendarLinks(html: string, testId: 'confirmation-calendar' | 'booking-calendar'): string[] {
  const links = html.matchAll(new RegExp(`<a href="([^"]+)"[^>]*data-testid="${testId}">Add to calendar</a>`, 'g'));
  return Array.from(links, (link) => link[1]!);
}

it('offers the saved session calendar in both booking and move confirmations', async () => {
  const patientId = clinic.patient1.id;
  await signIn(patientId);

  const booked = await confirmationFrom(bookAction, { slotId: slotChoices[0]!.id });
  const [booking] = await listBookingsForPatient(database.db, patientId);
  const path = `/bookings/${booking!.id}/calendar`;
  expect(booked).toContain('data-testid="notice">Booking confirmed.');
  expect(calendarLinks(booked, 'confirmation-calendar')).toEqual([path]);

  const moved = await confirmationFrom(rescheduleAction, { bookingId: booking!.id, newSlotId: slotChoices[2]!.id });
  expect(moved).toContain('data-testid="notice">Booking rescheduled.');
  expect(calendarLinks(moved, 'confirmation-calendar')).toEqual([path]);

  const { GET } = await import('@/app/bookings/[bookingId]/calendar/route');
  const file = await GET(new Request(`https://bookit.test${path}`), {
    params: Promise.resolve({ bookingId: booking!.id }),
  });
  expect(await file.text()).toContain('\r\nDTSTART:20261022T093000Z\r\nDTEND:20261022T101500Z\r\n');
});

it('lists and serves calendar downloads only for the signed-in client’s upcoming sessions', async () => {
  const deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
  const patientId = clinic.patient1.id;
  const started = await bookSlot(deps, { patientId, slotId: slotChoices[0]!.id });
  const first = await bookSlot(deps, { patientId, slotId: slotChoices[1]!.id });
  const cancelled = await bookSlot(deps, { patientId, slotId: slotChoices[2]!.id });
  const second = await bookSlot(deps, { patientId, slotId: slotChoices[3]!.id });
  const other = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: slotChoices[4]!.id });
  await cancelBooking(deps, { patientId, bookingId: cancelled.id });
  clock.set('2026-10-22T08:00:00Z');
  await signIn(patientId);

  const html = renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve({}) }));
  expect(calendarLinks(html, 'booking-calendar')).toEqual([first, second].map((b) => `/bookings/${b.id}/calendar`));
  const forgedNotice = renderToStaticMarkup(
    await MyBookingsPage({ searchParams: Promise.resolve({ notice: 'booked', booking: other.id }) }),
  );
  expect(calendarLinks(forgedNotice, 'confirmation-calendar')).toEqual([]);

  const { GET } = await import('@/app/bookings/[bookingId]/calendar/route');
  const download = (bookingId: string) =>
    GET(new Request(`https://bookit.test/bookings/${bookingId}/calendar`), { params: Promise.resolve({ bookingId }) });

  for (const booking of [first, second]) {
    const file = await download(booking.id);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(file.headers.get('Content-Disposition')).toBe('attachment; filename="physio-session.ics"');
    expect(file.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await file.text()).toContain(`\r\nUID:${booking.id}@bookit.test\r\n`);
  }
  for (const booking of [other, started, cancelled, { id: 'invalid' }]) {
    await expect(download(booking.id)).rejects.toMatchObject({
      digest: expect.stringContaining(';/bookings?error=calendar_unavailable;'),
    });
  }
  await signIn(clinic.admin.id);
  await expect(download(first.id)).rejects.toMatchObject({ digest: expect.stringContaining(';/;') });
  sessionToken = undefined;
  await expect(download(first.id)).rejects.toMatchObject({ digest: expect.stringContaining(';/auth/sign-in;') });
});
