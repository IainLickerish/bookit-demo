import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import AdminBookingsPage from '@/app/admin/page';
import { bookings, slots } from '@/db/schema';
import { newId } from '@/lib/ids';
import { addMinutes } from '@/lib/time';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { seedAdminBookings } from '../helpers/admin-fixture';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

const today = '2026-10-24T23:45:00Z';
const clock = manualClock(today);
let database: TestDatabase;
let clinic: SeededClinic;
let sessionToken: string | undefined;

vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));
vi.mock('@/lib/clock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE && sessionToken ? { value: sessionToken } : undefined),
  }),
}));

beforeAll(async () => {
  database = await startTestDatabase();
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7 } });
  await seedAdminBookings(database.db, clock);

  // Another physiotherapist has a confirmed session in the last hour of the 25-hour local day.
  const startsAt = new Date('2026-10-25T23:45:00Z');
  const slotId = newId(clock);
  await database.db.insert(slots).values({
    id: slotId,
    practitionerId: clinic.practitioners.weekdays,
    startsAt,
    endsAt: addMinutes(startsAt, 45),
    createdAt: clock.now(),
  });
  await database.db.insert(bookings).values({
    id: newId(clock),
    patientId: clinic.patient1.id,
    slotId,
    status: 'confirmed',
    lateCancellation: false,
    rescheduleCount: 0,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
});

beforeEach(() => {
  clock.set(today);
  sessionToken = undefined;
});

afterAll(async () => {
  await database?.stop();
});

async function renderAsStaff(filters: Record<string, string> = {}) {
  sessionToken = (await createSession(database.db, clock, clinic.admin.id)).token;
  return renderToStaticMarkup(await AdminBookingsPage({ searchParams: Promise.resolve(filters) }));
}

it('shows the confirmed count for the whole clinic day independently of the booking filters', async () => {
  const html = await renderAsStaff({
    date: '2026-10-26',
    status: 'cancelled',
    practitionerId: clinic.practitioners.saturdays,
  });
  expect(html).toContain('data-testid="admin-row-count">0 bookings</p>');
  expect(html).toContain('data-testid="admin-today-confirmed-count">2 confirmed sessions today.</p>');
});

it('uses the singular when one session is confirmed today', async () => {
  clock.set('2026-10-26T09:00:00Z');
  expect(await renderAsStaff()).toContain('data-testid="admin-today-confirmed-count">1 confirmed session today.</p>');
});

it('tells staff when there are no confirmed sessions today', async () => {
  clock.set('2026-10-27T09:00:00Z');
  expect(await renderAsStaff()).toContain('data-testid="admin-today-confirmed-count">No confirmed sessions today.</p>');
});

it('keeps the daily count behind a current clinic staff session', async () => {
  expect(await renderAsStaff()).toContain('data-testid="admin-today-confirmed-count"');

  const openBookings = () => AdminBookingsPage({ searchParams: Promise.resolve({}) });
  sessionToken = undefined;
  await expect(openBookings()).rejects.toMatchObject({
    digest: expect.stringContaining(';/auth/sign-in;'),
  });

  sessionToken = (await createSession(database.db, clock, clinic.patient1.id)).token;
  await expect(openBookings()).rejects.toMatchObject({
    digest: expect.stringContaining(';/bookings;'),
  });

  sessionToken = (await createSession(database.db, manualClock('2026-10-23T23:45:00Z'), clinic.admin.id)).token;
  await expect(openBookings()).rejects.toMatchObject({
    digest: expect.stringContaining(';/auth/sign-in;'),
  });
});
