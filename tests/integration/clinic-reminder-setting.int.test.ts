import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { saveSettingsAction } from '@/app/admin/settings/actions';
import { getClock } from '@/lib/clock';
import { createSession } from '@/server/auth/session';
import { loadClinicSettings } from '@/server/settings';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

let database: TestDatabase;
let clinic: SeededClinic;
let sessionToken: string | undefined;
const clock = getClock();

vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => (sessionToken ? { value: sessionToken } : undefined) }),
  headers: () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (destination: string) => {
    throw new Error(destination);
  },
}));

beforeAll(async () => {
  database = await startTestDatabase();
  clinic = await seedClinic(database.db, clock);
});

afterAll(async () => database?.stop());

it('lets only clinic staff turn reminder emails off and on', async () => {
  const form = new FormData();
  form.set('clinicName', clinic.settings.clinicName);
  form.set('timeZone', clinic.settings.timeZone);
  form.set('lateCancellationHours', String(clinic.settings.lateCancellationHours));

  await expect(saveSettingsAction(form)).rejects.toThrow('/auth/sign-in');
  sessionToken = (await createSession(database.db, clock, clinic.patient1.id)).token;
  await expect(saveSettingsAction(form)).rejects.toThrow('/bookings');
  expect((await loadClinicSettings(database.db)).reminderEmailsEnabled).toBe(true);

  sessionToken = (await createSession(database.db, clock, clinic.admin.id)).token;
  await expect(saveSettingsAction(form)).rejects.toThrow('/admin/settings?saved=1');
  expect((await loadClinicSettings(database.db)).reminderEmailsEnabled).toBe(false);

  form.set('reminderEmailsEnabled', 'on');
  await expect(saveSettingsAction(form)).rejects.toThrow('/admin/settings?saved=1');
  expect((await loadClinicSettings(database.db)).reminderEmailsEnabled).toBe(true);
});
