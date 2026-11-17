import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Database } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { saveSettingsAction } from '@/app/admin/settings/actions';
import AdminSettingsPage from '@/app/admin/settings/page';
import { createSession } from '@/server/auth/session';
import { loadClinicSettings } from '@/server/settings';
import { seedClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

const request = vi.hoisted(() => ({ db: undefined as Database | undefined, token: '' }));
vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  getDatabase: () => request.db!,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (request.token ? { value: request.token } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/clock', async (original) => ({
  ...(await original<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));

const clock = manualClock('2026-10-20T07:00:00Z');
let acme: TestDatabase;
let beacon: TestDatabase;
let admin: string;
let foreignAdmin: string;
let denied: { token: string; destination: string }[];

beforeAll(async () => {
  acme = await startTestDatabase();
  beacon = await startTestDatabase();
  const a = await seedClinic(acme.db, clock, { settings: { clinicName: 'Acme Physio', slotHorizonDays: 1 } });
  const b = await seedClinic(beacon.db, clock, { settings: { clinicName: 'Beacon Dental', slotHorizonDays: 1 } });
  admin = (await createSession(acme.db, clock, a.admin.id)).token;
  foreignAdmin = (await createSession(beacon.db, clock, b.admin.id)).token;
  const patient = (await createSession(acme.db, clock, a.patient1.id)).token;
  const expired = (await createSession(acme.db, manualClock('2026-10-19T07:00:00Z'), a.admin.id)).token;
  // A session must use the account's current role, rather than its role at sign-in.
  const downgraded = (await createSession(acme.db, clock, a.patient2.id)).token;
  await acme.db.update(users).set({ role: 'admin' }).where(eq(users.id, a.patient2.id));
  await acme.db.update(users).set({ role: 'patient' }).where(eq(users.id, a.patient2.id));
  denied = [
    { token: '', destination: '/auth/sign-in' },
    { token: 'forged-session', destination: '/auth/sign-in' },
    { token: expired, destination: '/auth/sign-in' },
    { token: foreignAdmin, destination: '/auth/sign-in' },
    { token: patient, destination: '/bookings' },
    { token: downgraded, destination: '/bookings' },
  ];
});

afterAll(async () => {
  await Promise.allSettled([acme?.stop(), beacon?.stop()]);
});

async function settingsForm(reminders: boolean) {
  const settings = await loadClinicSettings(request.db!);
  const form = new FormData();
  form.set('clinicName', settings.clinicName);
  form.set('timeZone', settings.timeZone);
  form.set('lateCancellationHours', String(settings.lateCancellationHours));
  if (settings.includeContactInConfirmation) form.set('includeContactInConfirmation', 'on');
  if (reminders) form.set('remindersEnabled', 'on');
  return form;
}

it('saves both reminder choices through the staff action independently for each clinic', async () => {
  for (const [own, other, token] of [
    [acme, beacon, admin],
    [beacon, acme, foreignAdmin],
  ] as const) {
    request.db = own.db;
    request.token = token;
    const otherSettings = await loadClinicSettings(other.db);
    const original = await loadClinicSettings(own.db);
    expect(original.remindersEnabled).toBe(true);
    for (const choice of [false, true]) {
      await expect(saveSettingsAction(await settingsForm(choice))).rejects.toMatchObject({
        digest: expect.stringContaining('/admin/settings?saved=1'),
      });
      expect(await loadClinicSettings(own.db)).toEqual({ ...original, remindersEnabled: choice });
      expect(await loadClinicSettings(other.db)).toEqual(otherSettings);
    }
  }
});

it('rejects unauthorised page reads and direct settings submissions without changing either clinic', async () => {
  request.db = acme.db;
  const before = await loadClinicSettings(acme.db);
  const other = await loadClinicSettings(beacon.db);
  for (const { token, destination } of denied) {
    request.token = token;
    await expect(AdminSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringContaining(destination),
    });
    await expect(saveSettingsAction(await settingsForm(false))).rejects.toMatchObject({
      digest: expect.stringContaining(destination),
    });
    expect(await loadClinicSettings(acme.db)).toEqual(before);
    expect(await loadClinicSettings(beacon.db)).toEqual(other);
  }
});

it('keeps the saved reminder choice on validation or storage failure and retains the attempted choice for retry', async () => {
  request.db = acme.db;
  request.token = admin;
  const before = await loadClinicSettings(acme.db);
  const invalid = await settingsForm(false);
  invalid.set('lateCancellationHours', '-1');
  await expect(saveSettingsAction(invalid)).rejects.toMatchObject({
    digest: expect.stringContaining('/admin/settings?error=invalid&reminders=off'),
  });
  expect(await loadClinicSettings(acme.db)).toEqual(before);
  const valid = await settingsForm(false);
  const failure = vi.spyOn(acme.db, 'update').mockImplementationOnce(() => {
    throw new Error('Synthetic storage failure');
  });
  try {
    await expect(saveSettingsAction(valid)).rejects.toMatchObject({
      digest: expect.stringContaining('/admin/settings?error=unavailable&reminders=off'),
    });
    expect(await loadClinicSettings(acme.db)).toEqual(before);
  } finally {
    failure.mockRestore();
  }
});
