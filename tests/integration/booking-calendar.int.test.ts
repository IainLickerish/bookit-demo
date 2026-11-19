import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/bookings/[bookingId]/calendar/route';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
let sessionToken: string | undefined;
const clock = manualClock('2026-10-20T07:00:00Z');

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === SESSION_COOKIE ? { value: sessionToken } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));
vi.mock('@/lib/clock', async (original) => ({
  ...(await original<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));

beforeAll(async () => {
  database = await startTestDatabase(5);
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  sessionToken = undefined;
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { clinicName: 'Acme Physio' } });
});

async function signIn(userId: string): Promise<void> {
  sessionToken = (await createSession(database.db, clock, userId)).token;
}

async function arrangeBooking() {
  const [first, second] = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T00:00:00Z'),
    until: new Date('2026-10-23T00:00:00Z'),
  });
  const deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
  const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: first!.id });
  return { booking, deps, targetSlotId: second!.id };
}

function download(bookingId: string): Promise<Response> {
  return GET(new Request(`http://bookit.test/bookings/${bookingId}/calendar`), {
    params: Promise.resolve({ bookingId }),
  });
}

it('downloads the current session for each of the signed-in client’s upcoming bookings', async () => {
  const { booking, deps, targetSlotId } = await arrangeBooking();
  await signIn(clinic.patient1.id);

  const initial = await download(booking.id);
  expect(initial.status).toBe(200);
  expect(initial.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(initial.headers.get('content-disposition')).toBe('attachment; filename="physiotherapy-session.ics"');
  expect(initial.headers.get('cache-control')).toBe('private, no-store');
  const entry = (await initial.text()).replaceAll('\r\n ', '');
  expect(entry).toContain('SUMMARY:Acme Physio session with Pat Physio\r\n');
  expect(entry).toContain('DTSTART:20261022T080000Z\r\nDTEND:20261022T084500Z\r\n');
  expect(entry).toContain('When: Thu\\, 22 Oct 2026\\, 09:00 (Europe/London)\\nLength: 45 minutes');
  expect(entry).not.toContain(clinic.patient1.email);
  expect(entry).not.toContain(clinic.patient1.name);

  await rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: targetSlotId });
  const updated = await (await download(booking.id)).text();
  expect(updated).toContain('DTSTART:20261022T084500Z\r\nDTEND:20261022T093000Z\r\n');

  const second = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: booking.slotId });
  expect(await (await download(second.id)).text()).toContain('DTSTART:20261022T080000Z\r\n');
  expect(await (await download(booking.id)).text()).toBe(updated);
});

it('refuses calendar downloads for signed-out visitors, staff, other clients and unavailable bookings', async () => {
  const { booking, deps } = await arrangeBooking();
  const notFound = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };
  await expect(download(booking.id)).rejects.toMatchObject({ digest: expect.stringContaining('/auth/sign-in;') });
  await signIn(clinic.admin.id);
  await expect(download(booking.id)).rejects.toMatchObject({ digest: expect.stringContaining(';/;') });
  await signIn(clinic.patient2.id);
  await expect(download(booking.id)).rejects.toMatchObject(notFound);

  await signIn(clinic.patient1.id);
  await expect(download('invalid-booking-id')).rejects.toMatchObject(notFound);
  await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
  await expect(download(booking.id)).rejects.toMatchObject(notFound);

  const second = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: booking.slotId });
  clock.set(second.startsAt.toISOString());
  await signIn(clinic.patient1.id);
  await expect(download(second.id)).rejects.toMatchObject(notFound);
});
