import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '@/db/client';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { bookingReminders, bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import { loadTenant } from '@/server/seed/tenant';
import { loadClinicSettings } from '@/server/settings';
import { seedAdminBookings } from '../helpers/admin-fixture';
import { manualClock } from '../helpers/clock';
import { databaseOn, startTestDatabase, type TestDatabase } from '../helpers/database';

let server: TestDatabase;
let legacyFolder: string;
const clock = manualClock('2026-10-20T07:00:00Z');

beforeAll(async () => {
  server = await startTestDatabase();
  legacyFolder = mkdtempSync(path.join(tmpdir(), 'bookit-before-reminders-'));
  mkdirSync(path.join(legacyFolder, 'meta'));
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx < 2);
  writeFileSync(path.join(legacyFolder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) {
    copyFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(legacyFolder, `${entry.tag}.sql`));
  }
});

afterAll(async () => {
  if (legacyFolder) rmSync(legacyFolder, { recursive: true, force: true });
  await server?.stop();
});

it.each(['acme', 'beacon'] as const)(
  'upgrades %s with reminders on and all existing activity unchanged',
  async (name) => {
    const database = await databaseOn(server.url);
    const handle = createDatabase(database.url);
    try {
      await migrate(handle.db, { migrationsFolder: legacyFolder });
      const tenant = loadTenant(name);
      const settings = tenant.settings;
      await handle.pool.query(
        `insert into clinic_settings
       (id, clinic_name, time_zone, late_cancellation_hours, include_contact_in_confirmation,
        slot_horizon_days, session_minutes, max_reschedules_per_booking, updated_at)
       values (1, $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          settings.clinicName,
          settings.timeZone,
          settings.lateCancellationHours,
          settings.includeContactInConfirmation,
          settings.slotHorizonDays,
          settings.sessionMinutes,
          settings.maxReschedulesPerBooking,
          clock.now(),
        ],
      );
      await seedAdminBookings(handle.db, clock, `reminder-upgrade-${name}`);
      const before = {
        settings: (await handle.pool.query('select * from clinic_settings')).rows as Record<string, unknown>[],
        bookings: await handle.db.select().from(bookings),
        slots: await handle.db.select().from(slots),
        users: await handle.db.select().from(users),
        practitioners: await handle.db.select().from(practitioners),
      };
      await runMigrations(database.url);
      expect(await handle.db.select().from(bookingReminders)).toEqual([]);
      expect(await loadClinicSettings(handle.db)).toEqual(settings);
      const upgraded = (await handle.pool.query('select * from clinic_settings')).rows as Record<string, unknown>[];
      expect(upgraded).toEqual(before.settings.map((row) => ({ ...row, reminders_enabled: true })));
      expect(await handle.db.select().from(bookings)).toEqual(before.bookings);
      expect(await handle.db.select().from(slots)).toEqual(before.slots);
      expect(await handle.db.select().from(users)).toEqual(before.users);
      expect(await handle.db.select().from(practitioners)).toEqual(before.practitioners);
      await handle.db.update(clinicSettings).set({ remindersEnabled: false });
      await runMigrations(database.url);
      expect((await loadClinicSettings(handle.db)).remindersEnabled).toBe(false);
      // Recovery keeps the additive column and restores the previous app, which ignores it.
      const previousAppSettings = await handle.pool.query('select clinic_name, time_zone from clinic_settings');
      expect(previousAppSettings.rows).toEqual([{ clinic_name: settings.clinicName, time_zone: settings.timeZone }]);
      expect(await handle.db.select().from(bookings)).toEqual(before.bookings);
    } finally {
      await handle.pool.end();
      await database.stop();
    }
  },
);
