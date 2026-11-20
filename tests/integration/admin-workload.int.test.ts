import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import AdminBookingsPage from '@/app/admin/page';
import type { SearchParams } from '@/app/messages';
import { bookings, slots } from '@/db/schema';
import { newId } from '@/lib/ids';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { seedClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

let database: TestDatabase;
let adminToken: string;
let patientToken: string;
let sessionToken: string | undefined;
const clock = manualClock('2026-10-24T23:05:00Z');

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE && sessionToken ? { value: sessionToken } : undefined),
  }),
}));
vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));
vi.mock('@/lib/clock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));

beforeAll(async () => {
  database = await startTestDatabase();
  const { db } = database;
  const clinic = await seedClinic(db, clock, { settings: { slotHorizonDays: 7 } });
  adminToken = (await createSession(db, clock, clinic.admin.id)).token;
  patientToken = (await createSession(db, clock, clinic.patient1.id)).token;

  // London falls back on 25 October. These sessions span both local midnights.
  const sessions = [
    ['2026-10-24T22:30:00Z', clinic.practitioners.saturdays, 'confirmed'],
    ['2026-10-24T23:00:00Z', clinic.practitioners.saturdays, 'confirmed'],
    ['2026-10-25T12:00:00Z', clinic.practitioners.weekdays, 'cancelled'],
    ['2026-10-25T23:30:00Z', clinic.practitioners.weekdays, 'confirmed'],
    ['2026-10-26T00:00:00Z', clinic.practitioners.weekdays, 'confirmed'],
  ] as const;
  const now = clock.now();
  for (const [start, practitionerId, status] of sessions) {
    const slotId = newId(clock);
    const startsAt = new Date(start);
    await db.insert(slots).values({
      id: slotId,
      practitionerId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      createdAt: now,
    });
    await db.insert(bookings).values({
      id: newId(clock),
      patientId: clinic.patient1.id,
      slotId,
      status,
      lateCancellation: false,
      rescheduleCount: 0,
      createdAt: now,
      updatedAt: now,
      cancelledAt: status === 'cancelled' ? now : null,
    });
  }
});

afterAll(async () => {
  await database?.stop();
});

async function bookingsPage(params: Awaited<SearchParams> = {}, token: string | undefined = adminToken) {
  sessionToken = token;
  return renderToStaticMarkup(await AdminBookingsPage({ searchParams: Promise.resolve(params) }));
}

it("shows the clinic's count of confirmed sessions for today by default", async () => {
  const html = await bookingsPage();
  expect(html).toContain('Sunday, 25 October 2026');
  expect(html).toMatch(/data-testid="admin-workload-count"[^>]*>2 confirmed sessions</);
});

it('shows the count for another chosen day, including days with no confirmed sessions', async () => {
  const chosen = await bookingsPage({ workloadDate: '2026-10-26' });
  expect(chosen).toContain('Monday, 26 October 2026');
  const dateInput = chosen.match(/<input [^>]*data-testid="admin-workload-date"[^>]*>/)?.[0];
  expect(dateInput).toContain('value="2026-10-26"');
  expect(dateInput).toMatch(/autocomplete="off"/i);
  expect(chosen).toMatch(/data-testid="admin-workload-count"[^>]*>1 confirmed session</);

  const empty = await bookingsPage({ workloadDate: '2026-10-27' });
  expect(empty).toMatch(/data-testid="admin-workload-count"[^>]*>0 confirmed sessions</);
});

it('redirects signed-out visitors and clients before showing the workload', async () => {
  const params = { workloadDate: '2026-10-25' };
  await expect(bookingsPage(params, '')).rejects.toMatchObject({
    digest: expect.stringContaining('/auth/sign-in'),
  });
  await expect(bookingsPage(params, patientToken)).rejects.toMatchObject({
    digest: expect.stringContaining('/bookings'),
  });
});

it('keeps the bookings list, export and settings available when a workload date is chosen', async () => {
  const html = await bookingsPage({ workloadDate: '2026-10-25', date: '2026-10-25', status: 'cancelled' });
  expect(html).toMatch(/data-testid="admin-workload-count"[^>]*>2 confirmed sessions</);
  expect(html).toMatch(/data-testid="admin-row-count"[^>]*>1 bookings</);
  expect(html).toContain('href="/api/admin/export?date=2026-10-25&amp;status=cancelled"');
  expect(html).toContain('href="/admin/settings"');
});

it('shows a date error without interrupting the bookings list', async () => {
  for (const workloadDate of ['2026-02-30', ['2026-10-25', '2026-10-26'], '9999-12-31']) {
    const html = await bookingsPage({ workloadDate });
    expect(html).toContain('data-testid="admin-workload-date-error"');
    expect(html).not.toContain('data-testid="admin-workload-count"');
    expect(html).toMatch(/data-testid="admin-row-count"[^>]*>5 bookings</);
  }
});
