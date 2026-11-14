import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bookingReminders, bookings, clinicSettings, slots } from '@/db/schema';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { loadClinicSettings } from '@/server/settings';
import { updateAdminSettings } from '@/server/admin/settings';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';

const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
const id = (suffix: number) => `019a0000-0000-7000-8000-${String(suffix).padStart(12, '0')}`;

beforeAll(async () => {
  database = await startTestDatabase(5, false);
});
afterAll(async () => {
  await database?.stop();
});

it('upgrades existing bookings and settings, retains reminder history, and supports recovery using the previous app', async () => {
  const pool = database.handle.pool;
  // Apply only the already released migrations, using their real migration journal.
  const directory = await mkdtemp(path.join(tmpdir(), 'bookit-before-reminders-'));
  try {
    await mkdir(path.join(directory, 'meta'));
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < 2);
    await writeFile(path.join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      await copyFile(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(directory, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  // Fictional records written using the previous schema, including moved and cancelled bookings.
  await pool.query(
    `insert into clinic_settings values (1, 'Existing Clinic', 'Europe/London', 48, true, 30, 45, 3, $1)`,
    [clock.now()],
  );
  await pool.query(
    `insert into "user" (id, email, name, role, password_hash, created_at, updated_at) values ($1, 'migration@patients.example.test', 'Fictional Client', 'patient', 'unused-test-hash', $2, $2)`,
    [id(1), clock.now()],
  );
  await pool.query(
    `insert into practitioner values ($1, 'Fictional Practitioner', 'Test', array[1,2,3,4,5]::smallint[], '09:00', '17:00', true, $2, $2)`,
    [id(2), clock.now()],
  );
  for (const n of [3, 4, 5, 6]) {
    await pool.query(`insert into slot values ($1, $2, $3, $4, $5)`, [
      id(n),
      id(2),
      new Date(`2026-10-${20 + n}T09:00:00Z`),
      new Date(`2026-10-${20 + n}T09:45:00Z`),
      clock.now(),
    ]);
  }
  for (const n of [7, 8, 9]) {
    await pool.query(
      `insert into booking (id, patient_id, slot_id, status, late_cancellation, phone, reschedule_count, created_at, updated_at, cancelled_at) values ($1, $2, $3, $4, false, null, $5, $6, $6, $7)`,
      [
        id(n),
        id(1),
        id(n - 4),
        n === 8 ? 'cancelled' : 'confirmed',
        n === 9 ? 1 : 0,
        clock.now(),
        n === 8 ? clock.now() : null,
      ],
    );
  }
  const before = await pool.query('select * from booking order by id');
  const previousSettings = (await pool.query('select * from clinic_settings')).rows[0] as Record<string, unknown>;
  await runMigrations(database.url);
  expect((await pool.query('select * from booking order by id')).rows).toEqual(before.rows);
  expect((await pool.query('select * from clinic_settings')).rows).toEqual([
    { ...previousSettings, reminders_enabled: false },
  ]);
  expect(await database.db.select().from(bookingReminders)).toEqual([]);

  const [slot] = await database.db
    .select()
    .from(slots)
    .where(eq(slots.id, id(3)));
  const reservation = { bookingId: id(7), slotId: id(3), startsAt: slot!.startsAt, reservedAt: clock.now() };
  // Two concurrent claims cannot both be stored for a booking.
  const results = await Promise.allSettled([
    database.db.insert(bookingReminders).values(reservation),
    database.db.insert(bookingReminders).values(reservation),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const [history] = await database.db.select().from(bookingReminders);
  expect(history).toEqual({ ...reservation, sentAt: null });
  await expect(database.db.insert(bookingReminders).values({ ...reservation, bookingId: id(99) })).rejects.toThrow();
  await expect(
    database.db.insert(bookingReminders).values({ ...reservation, bookingId: id(8), slotId: id(99) }),
  ).rejects.toThrow();
  await expect(
    database.db.update(bookingReminders).set({ sentAt: new Date('2026-10-19T07:00:00Z') }),
  ).rejects.toThrow();
  await database.db.update(bookingReminders).set({ sentAt: clock.now() });
  await database.db
    .update(bookings)
    .set({ slotId: id(6), rescheduleCount: 1 })
    .where(eq(bookings.id, id(7)));
  await database.db
    .update(bookings)
    .set({ status: 'cancelled', cancelledAt: clock.now() })
    .where(eq(bookings.id, id(7)));
  expect(await database.db.select().from(bookingReminders)).toEqual([{ ...reservation, sentAt: clock.now() }]);

  const settings = await loadClinicSettings(database.db);
  await updateAdminSettings(database.db, clock, {
    clinicName: settings.clinicName,
    timeZone: settings.timeZone,
    lateCancellationHours: settings.lateCancellationHours,
    includeContactInConfirmation: settings.includeContactInConfirmation,
    remindersEnabled: true,
  });
  // Recovery keeps the additive schema. These are the previous app's field projections and writes.
  expect((await pool.query('select id, patient_id, slot_id, status, reschedule_count from booking')).rowCount).toBe(3);
  await pool.query(
    'update clinic_settings set clinic_name = $1, late_cancellation_hours = $2, updated_at = $3 where id = 1',
    ['Recovered Clinic', 24, clock.now()],
  );
  // The previous app can still create bookings, omitting all new reminder fields.
  await pool.query(
    `insert into booking (id, patient_id, slot_id, status, late_cancellation, phone, reschedule_count, created_at, updated_at, cancelled_at) values ($1, $2, $3, 'confirmed', false, null, 0, $4, $4, null)`,
    [id(10), id(1), id(3), clock.now()],
  );
  const beforeRecovery = await database.db.select().from(bookings).orderBy(bookings.id);
  expect(beforeRecovery).toHaveLength(4);
  // Returning to the new app reruns migrations without resetting either history or staff choice.
  await runMigrations(database.url);
  expect(await database.db.select().from(bookings).orderBy(bookings.id)).toEqual(beforeRecovery);
  expect(await database.db.select().from(bookingReminders)).toEqual([{ ...reservation, sentAt: clock.now() }]);
  expect((await database.db.select().from(clinicSettings))[0]).toMatchObject({
    clinicName: 'Recovered Clinic',
    remindersEnabled: true,
    lateCancellationHours: 24,
  });
});

it('creates an empty clinic database with reminders off by default', async () => {
  const fresh = await startTestDatabase();
  try {
    await fresh.db.insert(clinicSettings).values({
      id: 1,
      clinicName: 'New Clinic',
      timeZone: 'Europe/London',
      lateCancellationHours: 24,
      includeContactInConfirmation: false,
      slotHorizonDays: 30,
      sessionMinutes: 45,
      maxReschedulesPerBooking: 3,
      updatedAt: clock.now(),
    });
    expect((await loadClinicSettings(fresh.db)).remindersEnabled).toBe(false);
    expect(await fresh.db.select().from(bookingReminders)).toEqual([]);
  } finally {
    await fresh.stop();
  }
});
