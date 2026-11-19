import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GET } from '@/app/bookings/[bookingId]/calendar/route';
import { getClock } from '@/lib/clock';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let sessionToken: string | undefined;

vi.mock(import('@/db/client'), async (original) => ({
  ...(await original()),
  getDatabase: () => database.db,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE && sessionToken ? { value: sessionToken } : undefined),
  }),
}));

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

function download(bookingId: string): Promise<Response> {
  return GET(new Request(`http://bookit.test/bookings/${bookingId}/calendar`), {
    params: Promise.resolve({ bookingId }),
  });
}

it('only downloads the calendar file for the signed-in client’s own upcoming confirmed booking', async () => {
  const { db } = database;
  const clock = getClock();
  const earlier = manualClock('2026-10-19T07:00:00Z');
  const clinic = await seedClinic(db, earlier, { settings: { clinicName: 'Acme Physio' } });
  const deps = { db, clock, log: captureLogs(clock).log, mail: testMail() };
  const [pastSlot] = await listAvailableSlots(db, {
    practitionerId: clinic.practitioners.weekdays,
    after: earlier.now(),
    until: clock.now(),
  });
  const past = await bookSlot({ ...deps, clock: earlier }, { patientId: clinic.patient1.id, slotId: pastSlot!.id });
  const [upcomingSlot] = await listAvailableSlots(db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T07:59:00Z'),
    until: new Date('2026-10-22T09:00:00Z'),
  });
  const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: upcomingSlot!.id });

  await expect(download(booking.id)).rejects.toMatchObject({ digest: expect.stringContaining('/auth/sign-in') });
  sessionToken = (await createSession(db, clock, clinic.admin.id)).token;
  await expect(download(booking.id)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  sessionToken = (await createSession(db, clock, clinic.patient2.id)).token;
  expect((await download(booking.id)).status).toBe(404);

  sessionToken = (await createSession(db, clock, clinic.patient1.id)).token;
  expect((await download(past.id)).status).toBe(404);
  expect((await download('invalid')).status).toBe(404);
  const response = await download(booking.id);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="physio-session.ics"');
  expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
  const calendar = await response.text();
  expect(calendar).toContain('SUMMARY:Acme Physio session with Pat Physio\r\n');
  expect(calendar).toContain('DTSTART:20261022T080000Z\r\nDTEND:20261022T084500Z\r\n');
  expect(calendar).not.toMatch(/Patient One|patients\.example\.test|7700/);

  await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
  expect((await download(booking.id)).status).toBe(404);
});
