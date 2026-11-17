import { mkdtemp, readFile, readdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '@/db/client';
import { bookings, slots, clinicSettings } from '@/db/schema';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { newId } from '@/lib/ids';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, type Mailer } from '@/server/notifications/mailer';
import { sendDueReminders } from '@/server/notifications/reminders';
import { loadClinicSettings } from '@/server/settings';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { databaseOn, emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { startSmtpReceiver, TEST_MAIL_FROM, type SmtpReceiver } from '../helpers/mail';

let database: TestDatabase;
let beacon: TestDatabase;
let clinic: SeededClinic;
let smtp: SmtpReceiver;
const clock = manualClock('2026-10-20T07:00:00Z');
const logs = captureLogs(clock);
const publicUrl = new URL('https://acme.example.test');
function deps(mailer: Mailer = createSmtpMailer(smtp.url)) {
  return { db: database.db, clock, log: logs.log, mail: { mailer, from: TEST_MAIL_FROM }, publicUrl, tenant: 'acme' };
}
async function slot(at: string, practitionerId = clinic.practitioners.weekdays) {
  const id = newId(clock);
  await database.db
    .insert(slots)
    .values({
      id,
      practitionerId,
      startsAt: new Date(at),
      endsAt: new Date(Date.parse(at) + 45 * 60_000),
      createdAt: clock.now(),
    })
    .onConflictDoNothing();
  const [row] = await database.db
    .select()
    .from(slots)
    .where(and(eq(slots.practitionerId, practitionerId), eq(slots.startsAt, new Date(at))));
  return row!.id;
}
async function book(at = '2026-10-21T08:00:00Z') {
  return bookSlot(deps(), { patientId: clinic.patient1.id, slotId: await slot(at) });
}
function textBody(raw: string) {
  return raw
    .slice(raw.search(/\r?\n\r?\n/))
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
beforeAll(async () => {
  database = await startTestDatabase();
  beacon = await startTestDatabase();
  smtp = await startSmtpReceiver();
  await seedClinic(beacon.db, clock, { settings: { clinicName: 'Beacon Dental', slotHorizonDays: 7 } });
});
afterAll(async () => {
  await smtp?.stop();
  await database?.stop();
  await beacon?.stop();
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7 } });
  smtp.messages.length = 0;
});

describe('day-before reminders', () => {
  it('sends at 24 hours, once across simultaneous workers, repeated checks and a restart', async () => {
    const booking = await book();
    smtp.messages.length = 0;
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(0);
    clock.set('2026-10-20T08:00:00Z');
    await Promise.all(Array.from({ length: 5 }, () => sendDueReminders(deps())));
    expect(smtp.messages).toHaveLength(1);
    const body = textBody(smtp.messages[0]!.raw);
    expect(smtp.messages[0]!.to).toEqual([clinic.patient1.email]);
    expect(body).toContain('Wed, 21 Oct 2026, 09:00 (UK time, Europe/London)');
    expect(body).toContain('Your physiotherapist: Pat Physio');
    expect(body).toContain('your session');
    expect(body).toContain('To reschedule or cancel, open My bookings: https://acme.example.test/bookings');
    expect(body).not.toContain(clinic.patient2.email);
    expect(body).not.toContain('7700');
    const restarted = createDatabase(database.url);
    try {
      await sendDueReminders({ ...deps(), db: restarted.db });
    } finally {
      await restarted.pool.end();
    }
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
    expect(
      (await database.db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]!.reminderAttemptedAt,
    ).not.toBeNull();
  });

  it('never reminds a cancelled booking', async () => {
    const booking = await book('2026-10-22T08:00:00Z');
    await cancelBooking(deps(), { patientId: booking.patientId, bookingId: booking.id });
    smtp.messages.length = 0;
    clock.set('2026-10-21T08:00:00Z');
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(0);
  });

  it('uses the new time and practitioner after a move and does not send at the old time', async () => {
    const booking = await book();
    await rescheduleBooking(deps(), {
      patientId: booking.patientId,
      bookingId: booking.id,
      newSlotId: await slot('2026-10-22T09:00:00Z', clinic.practitioners.saturdays),
    });
    smtp.messages.length = 0;
    clock.set('2026-10-20T08:00:00Z');
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(0);
    clock.set('2026-10-21T09:00:00Z');
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
    expect(textBody(smtp.messages[0]!.raw)).toContain('Thu, 22 Oct 2026, 10:00');
    expect(textBody(smtp.messages[0]!.raw)).toContain('Your physiotherapist: Sam Sports');
    expect(textBody(smtp.messages[0]!.raw)).not.toContain('Pat Physio');
  });

  it.each(['move', 'cancel'] as const)('rechecks a %s committed after the reminder was claimed', async (change) => {
    const booking = await book();
    const newSlotId = await slot('2026-10-22T09:00:00Z', clinic.practitioners.saturdays);
    clock.set('2026-10-20T08:00:00Z');
    smtp.messages.length = 0;
    const blocker = await database.handle.pool.connect();
    let sending: Promise<void> | undefined;
    try {
      await blocker.query('begin');
      // Pause delivery after its durable claim, without blocking booking changes.
      await blocker.query('select id from clinic_settings where id = 1 for update');
      sending = sendDueReminders(deps());
      await vi.waitFor(
        async () => {
          const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
          expect(row!.reminderAttemptedAt).not.toBeNull();
        },
        { timeout: 5000, interval: 20 },
      );
      if (change === 'move') {
        await rescheduleBooking(deps(), { patientId: booking.patientId, bookingId: booking.id, newSlotId });
      } else {
        await cancelBooking(deps(), { patientId: booking.patientId, bookingId: booking.id });
      }
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await sending;
    }
    expect(smtp.messages).toHaveLength(0);
    if (change === 'move') {
      clock.set('2026-10-21T09:00:00Z');
      await sendDueReminders(deps());
      expect(smtp.messages).toHaveLength(1);
      expect(textBody(smtp.messages[0]!.raw)).toContain('Thu, 22 Oct 2026, 10:00');
      expect(textBody(smtp.messages[0]!.raw)).toContain('Sam Sports');
    }
  });

  it('does not send a second reminder when a previously reminded booking moves', async () => {
    const booking = await book();
    clock.set('2026-10-20T08:00:00Z');
    smtp.messages.length = 0;
    await sendDueReminders(deps());
    await rescheduleBooking(deps(), {
      patientId: booking.patientId,
      bookingId: booking.id,
      newSlotId: await slot('2026-10-22T09:00:00Z'),
    });
    clock.set('2026-10-21T09:00:00Z');
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
  });

  it('includes short-notice bookings and catches up after downtime, but excludes appointments already started', async () => {
    await book('2026-10-20T10:00:00Z');
    await book('2026-10-20T11:00:00Z');
    clock.set('2026-10-20T10:00:00Z');
    smtp.messages.length = 0;
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
    expect(textBody(smtp.messages[0]!.raw)).toContain('12:00');
  });

  it('saves off and on only in the selected clinic and leaves due reminders available while off', async () => {
    await book();
    const other = await loadClinicSettings(beacon.db);
    await updateAdminSettings(database.db, clock, {
      clinicName: clinic.settings.clinicName,
      timeZone: clinic.settings.timeZone,
      lateCancellationHours: clinic.settings.lateCancellationHours,
      includeContactInConfirmation: clinic.settings.includeContactInConfirmation,
      remindersEnabled: false,
    });
    clock.set('2026-10-20T08:00:00Z');
    smtp.messages.length = 0;
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(0);
    expect((await loadClinicSettings(database.db)).remindersEnabled).toBe(false);
    expect(await loadClinicSettings(beacon.db)).toEqual(other);
    await database.db.update(clinicSettings).set({ remindersEnabled: true });
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
  });

  it('never retries an ambiguous mail failure, preserving the booking', async () => {
    const booking = await book();
    clock.set('2026-10-20T08:00:00Z');
    let attempts = 0;
    const mailer: Mailer = {
      kind: 'recording',
      async send() {
        attempts++;
        throw new Error('SMTP outcome uncertain');
      },
    };
    await sendDueReminders(deps(mailer));
    await sendDueReminders(deps(mailer));
    expect(attempts).toBe(1);
    expect((await database.db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]!.status).toBe('confirmed');
  });

  it.each([
    ['2027-03-27T07:00:00Z', '2027-03-28T08:00:00Z', '2027-03-27T08:00:00Z', 'Sun, 28 Mar 2027, 09:00'],
    ['2026-10-24T07:00:00Z', '2026-10-25T09:00:00Z', '2026-10-24T09:00:00Z', 'Sun, 25 Oct 2026, 09:00'],
  ])('uses 24 elapsed hours and UK time across the clock change from %s', async (start, at, due, shown) => {
    clock.set(start);
    await book(at);
    smtp.messages.length = 0;
    clock.set(due);
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
    expect(textBody(smtp.messages[0]!.raw)).toContain(shown);
  });
});

it('migrates an existing booking without changing its details, and defaults reminders on', async () => {
  const server = await databaseOn(database.url);
  const folder = await mkdtemp(path.join(tmpdir(), 'bookit-reminder-migration-'));
  const pool = new Pool({ connectionString: server.url });
  try {
    for (const file of await readdir(MIGRATIONS_FOLDER))
      await cp(path.join(MIGRATIONS_FOLDER, file), path.join(folder, file), { recursive: true });
    const journalPath = path.join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => !entry.tag.startsWith('0002_'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.query(
      `insert into "user" (id,email,name,role,password_hash,created_at,updated_at) values ($1,'migration@patient.test','Migration Patient','patient','unused',$2,$2)`,
      [clinic.patient1.id, clock.now()],
    );
    await pool.query(
      `insert into practitioner (id,name,bio,working_days,workday_start,workday_end,active,created_at,updated_at) values ($1,'Migration Practitioner','',array[1],'09:00','17:00',true,$2,$2)`,
      [clinic.practitioners.weekdays, clock.now()],
    );
    const slotId = newId(clock);
    const bookingId = newId(clock);
    await pool.query(`insert into slot (id,practitioner_id,starts_at,ends_at,created_at) values ($1,$2,$3,$4,$3)`, [
      slotId,
      clinic.practitioners.weekdays,
      new Date('2026-10-21T08:00:00Z'),
      new Date('2026-10-21T08:45:00Z'),
    ]);
    await pool.query(
      `insert into booking (id,patient_id,slot_id,status,late_cancellation,reschedule_count,created_at,updated_at) values ($1,$2,$3,'confirmed',false,0,$4,$4)`,
      [bookingId, clinic.patient1.id, slotId, clock.now()],
    );
    await pool.query(`insert into clinic_settings values (1,'Migration Clinic','Europe/London',24,false,7,45,3,$1)`, [
      clock.now(),
    ]);
    const before = (await pool.query('select * from booking')).rows[0];
    await runMigrations(server.url);
    const after = (await pool.query('select * from booking')).rows[0];
    expect(after).toEqual({ ...before, reminder_attempted_at: null });
    expect((await pool.query('select reminders_enabled from clinic_settings')).rows[0]).toEqual({
      reminders_enabled: true,
    });
  } finally {
    await pool.end();
    await server.stop();
    await rm(folder, { recursive: true, force: true });
  }
});
