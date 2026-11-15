import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { createDatabase } from '@/db/client';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { bookings } from '@/db/schema';
import { sendDueReminders } from '@/server/notifications/reminders';
import { loadClinicSettings } from '@/server/settings';
import { manualClock } from '../helpers/clock';
import { POSTGRES_IMAGE } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

it('upgrades an existing clinic without changing its bookings, phones or settings, and makes those bookings eligible for reminders', async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('reminder_upgrade').start();
  const folder = await mkdtemp(path.join(tmpdir(), 'bookit-old-migrations-'));
  const url = container.getConnectionUri();
  const pool = new Pool({ connectionString: url });
  const handle = createDatabase(url);
  try {
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < 2);
    await mkdir(path.join(folder, 'meta'));
    await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      await cp(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const ids = { patient: randomUUID(), practitioner: randomUUID(), slot: randomUUID(), booking: randomUUID() };
    const clock = manualClock('2026-10-20T07:00:00Z');
    await pool.query(
      `insert into clinic_settings values (1, 'Upgrade Clinic', 'Europe/London', 48, true, 220, 45, 3, $1)`,
      [clock.now()],
    );
    await pool.query(
      `insert into "user" values ($1, 'upgrade@patients.example.test', 'Upgrade Client', 'patient', null, 'unused-fictional-hash', $2, $2)`,
      [ids.patient, clock.now()],
    );
    await pool.query(
      `insert into practitioner values ($1, 'Upgrade Practitioner', 'Fictional', '{1,2,3,4,5}', '09:00', '17:00', true, $2, $2)`,
      [ids.practitioner, clock.now()],
    );
    await pool.query(`insert into slot values ($1, $2, '2026-10-21T07:00:00Z', '2026-10-21T07:45:00Z', $3)`, [
      ids.slot,
      ids.practitioner,
      clock.now(),
    ]);
    await pool.query(`insert into booking values ($1, $2, $3, 'confirmed', false, null, 1, $4, $4, null)`, [
      ids.booking,
      ids.patient,
      ids.slot,
      clock.now(),
    ]);
    const before = (await pool.query('select * from booking')).rows as Record<string, unknown>[];
    await runMigrations(url);
    const [after] = await handle.db.select().from(bookings);
    expect(after).toMatchObject({
      id: ids.booking,
      status: 'confirmed',
      phone: null,
      slotId: ids.slot,
      rescheduleCount: 1,
      reminderAttemptedAt: null,
    });
    const afterRaw = (await pool.query('select * from booking')).rows[0] as Record<string, unknown>;
    const { reminder_attempted_at: attempted, ...unchanged } = afterRaw;
    expect(attempted).toBeNull();
    expect(unchanged).toEqual(before[0]);
    expect(await loadClinicSettings(handle.db)).toMatchObject({
      clinicName: 'Upgrade Clinic',
      lateCancellationHours: 48,
      includeContactInConfirmation: true,
      remindersEnabled: true,
    });
    const mailer = recordingMailer();
    await sendDueReminders({
      db: handle.db,
      clock,
      log: captureLogs(clock).log,
      mail: testMail(mailer),
      publicUrl: new URL('https://upgrade.example.test'),
      tenant: 'acme',
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain(`Booking reference: ${ids.booking}`);
    // Application rollback is safe with the additive columns retained. Do not
    // drop the attempt history, which would make sent reminders eligible again.
    expect((await pool.query('select id, status, phone from booking')).rows).toEqual([
      { id: ids.booking, status: 'confirmed', phone: null },
    ]);
  } finally {
    await handle.pool.end();
    await pool.end();
    await container.stop();
    await rm(folder, { recursive: true, force: true });
  }
});
