import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { saveSettingsAction } from '@/app/admin/settings/actions';
import AdminSettingsPage from '@/app/admin/settings/page';
import { users } from '@/db/schema';
import { createSession } from '@/server/auth/session';
import { loadClinicSettings } from '@/server/settings';
import { seedClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

let acme: TestDatabase;
let beacon: TestDatabase;
let active: TestDatabase;
let token = '';
const clock = manualClock('2026-10-20T07:00:00Z');
const logs = captureLogs(clock);
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => (token ? { value: token } : undefined) }),
  headers: () => new Headers(),
}));
vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  getDatabase: () => active.db,
}));
vi.mock('@/lib/clock', async (original) => ({
  ...(await original<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));
vi.mock('@/lib/logger', async (original) => ({
  ...(await original<typeof import('@/lib/logger')>()),
  getLogger: () => logs.log,
}));

beforeAll(async () => {
  acme = await startTestDatabase();
  beacon = await startTestDatabase();
});
afterAll(async () => {
  await Promise.allSettled([acme?.stop(), beacon?.stop()]);
});

it('only the current clinic’s staff can read and save its reminder choice', async () => {
  const a = await seedClinic(acme.db, clock, { settings: { slotHorizonDays: 2 } });
  const b = await seedClinic(beacon.db, clock, { settings: { clinicName: 'Beacon Dental', slotHorizonDays: 2 } });
  const acmeToken = (await createSession(acme.db, clock, a.admin.id)).token;
  const beaconToken = (await createSession(beacon.db, clock, b.admin.id)).token;
  const patientToken = (await createSession(acme.db, clock, a.patient1.id)).token;
  const expiredToken = (await createSession(acme.db, manualClock('2026-10-19T07:00:00Z'), a.admin.id)).token;
  const before = await loadClinicSettings(acme.db);
  const form = new FormData();
  form.set('clinicName', before.clinicName);
  form.set('timeZone', before.timeZone);
  form.set('lateCancellationHours', String(before.lateCancellationHours));
  form.set('remindersEnabled', 'on');
  active = acme;
  for (token of ['', 'forged', patientToken, expiredToken, beaconToken]) {
    const target = token === patientToken ? '/bookings' : '/auth/sign-in';
    await expect(AdminSettingsPage()).rejects.toThrow(`redirect:${target}`);
    await expect(saveSettingsAction({}, form)).rejects.toThrow(`redirect:${target}`);
    expect(await loadClinicSettings(acme.db)).toEqual(before);
  }
  token = acmeToken;
  await expect(saveSettingsAction({}, form)).resolves.toEqual({ saved: true });
  expect(await loadClinicSettings(acme.db)).toEqual({ ...before, remindersEnabled: true });
  expect((await loadClinicSettings(beacon.db)).remindersEnabled).toBe(false);
  // Even an existing session loses permission when its account's role changes.
  await acme.db.update(users).set({ role: 'patient' }).where(eq(users.id, a.admin.id));
  form.set('remindersEnabled', 'off');
  await expect(saveSettingsAction({}, form)).rejects.toThrow('redirect:/bookings');
  expect((await loadClinicSettings(acme.db)).remindersEnabled).toBe(true);
  active = beacon;
  token = acmeToken;
  await expect(saveSettingsAction({}, form)).rejects.toThrow('redirect:/auth/sign-in');
  token = beaconToken;
  await expect(saveSettingsAction({}, form)).resolves.toEqual({ saved: true });
  expect((await loadClinicSettings(beacon.db)).remindersEnabled).toBe(false);
});
