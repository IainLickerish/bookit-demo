import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { bookings, clinicSettings } from '@/db/schema';
import { listBookingsForPatient } from '@/server/bookings/queries';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { loadClinicSettings } from '@/server/settings';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

let database: TestDatabase;
const clock = manualClock('2026-10-20T07:00:00Z');
const tenant = loadTenant('acme');
const input = {
  tenant,
  environment: 'local',
  passwords: Object.fromEntries(tenant.accounts.map((account) => [account.email, 'fictional-upgrade-password'])),
};
beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});

it('upgrades existing booking history, keeps legacy seed identity valid and enables reminders without replacing settings', async () => {
  await seedTenant(database.db, clock, input);
  const before = await database.db.select().from(bookings);
  expect(before.length).toBeGreaterThan(0);
  // Rehearse upgrading the previous schema with its existing history and seed
  // identity. Only this disposable test database is ever changed backwards.
  await database.db.execute(sql`alter table booking drop column reminder_attempted_at, drop column reminder_sent_at`);
  await database.db.execute(sql`alter table clinic_settings drop column reminders_enabled`);
  await database.db.execute(
    sql`delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`,
  );
  await runMigrations(database.url);
  expect(await database.db.select().from(bookings)).toEqual(before);
  expect((await loadClinicSettings(database.db)).remindersEnabled).toBe(true);
  expect((await seedTenant(database.db, clock, input)).outcome).toBe('unchanged');
  expect(await database.db.select().from(bookings)).toEqual(before);
  const patientId = before[0]!.patientId;
  expect((await listBookingsForPatient(database.db, patientId)).length).toBeGreaterThan(0);
  await database.db.update(clinicSettings).set({ remindersEnabled: false }).where(eq(clinicSettings.id, 1));
  await runMigrations(database.url);
  await seedTenant(database.db, clock, input);
  expect((await loadClinicSettings(database.db)).remindersEnabled).toBe(false);
});
