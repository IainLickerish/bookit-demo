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
import { seedTenant, assertSeedIdentity } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import previousSeeds from '../fixtures/seed-before-reminders.json';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, disabledMailer, type Mailer } from '@/server/notifications/mailer';
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
    let release!: () => void;
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const claimed = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const original = database.db.transaction.bind(database.db);
    const pause = vi.spyOn(database.db, 'transaction').mockImplementationOnce(async (body, config) => {
      const result = await original(body, config);
      // The durable claim has committed. Hold delivery until the move/cancel commits.
      reached();
      await proceed;
      return result;
    });
    const sending = sendDueReminders(deps());
    try {
      await claimed;
      if (change === 'move') {
        await rescheduleBooking(deps(), { patientId: booking.patientId, bookingId: booking.id, newSlotId });
      } else {
        await cancelBooking(deps(), { patientId: booking.patientId, bookingId: booking.id });
      }
    } finally {
      release();
      await sending;
      pause.mockRestore();
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

  it.each(['smtp', 'disabled'] as const)(
    'saves off only in the selected clinic and keeps due reminders skipped after re-enabling (%s)',
    async (transport) => {
      const booking = await book();
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
      await sendDueReminders(deps(transport === 'disabled' ? disabledMailer : createSmtpMailer(smtp.url)));
      expect(smtp.messages).toHaveLength(0);
      expect((await loadClinicSettings(database.db)).remindersEnabled).toBe(false);
      expect(await loadClinicSettings(beacon.db)).toEqual(other);
      await database.db.update(clinicSettings).set({ remindersEnabled: true });
      const restarted = createDatabase(database.url);
      try {
        await sendDueReminders({ ...deps(), db: restarted.db });
      } finally {
        await restarted.pool.end();
      }
      await sendDueReminders(deps());
      expect(smtp.messages).toHaveLength(0);
      await rescheduleBooking(deps(), {
        patientId: booking.patientId,
        bookingId: booking.id,
        newSlotId: await slot('2026-10-22T09:00:00Z', clinic.practitioners.saturdays),
      });
      clock.set('2026-10-21T09:00:00Z');
      await sendDueReminders(deps());
      await sendDueReminders(deps());
      expect(smtp.messages).toHaveLength(1);
      expect(textBody(smtp.messages[0]!.raw)).toContain('Thu, 22 Oct 2026, 10:00');
      expect(textBody(smtp.messages[0]!.raw)).toContain('Sam Sports');
      expect(await loadClinicSettings(beacon.db)).toEqual(other);
    },
  );

  it.each([false, true])(
    'skips reminders due while off when staff enable without a worker check (concurrent worker: %s)',
    async (concurrent) => {
      const booking = await book();
      const future = await book('2026-10-22T08:00:00Z');
      const other = await loadClinicSettings(beacon.db);
      const settings = (remindersEnabled: boolean) => ({
        clinicName: clinic.settings.clinicName,
        timeZone: clinic.settings.timeZone,
        lateCancellationHours: clinic.settings.lateCancellationHours,
        includeContactInConfirmation: clinic.settings.includeContactInConfirmation,
        remindersEnabled,
      });
      await updateAdminSettings(database.db, clock, settings(false));
      clock.set('2026-10-20T08:00:00Z');
      smtp.messages.length = 0;
      // No worker runs between becoming due and the staff action.
      if (concurrent) {
        await Promise.all([updateAdminSettings(database.db, clock, settings(true)), sendDueReminders(deps())]);
      } else {
        await updateAdminSettings(database.db, clock, settings(true));
      }
      await sendDueReminders(deps());
      expect(smtp.messages).toHaveLength(0);
      const rows = await database.db.select().from(bookings);
      expect(rows.find((row) => row.id === booking.id)!.reminderSkippedAt).not.toBeNull();
      expect(rows.find((row) => row.id === future.id)!.reminderSkippedAt).toBeNull();
      expect(await loadClinicSettings(beacon.db)).toEqual(other);
      await rescheduleBooking(deps(), {
        patientId: booking.patientId,
        bookingId: booking.id,
        newSlotId: await slot('2026-10-21T09:00:00Z', clinic.practitioners.saturdays),
      });
      clock.set('2026-10-20T09:00:00Z');
      await sendDueReminders(deps());
      await sendDueReminders(deps());
      expect(smtp.messages).toHaveLength(1);
      expect(textBody(smtp.messages[0]!.raw)).toContain('Sam Sports');
    },
  );

  it.each(['create', 'move'] as const)('waits for re-enabling to commit before a concurrent %s', async (operation) => {
    const existing = operation === 'move' ? await book('2026-10-22T08:00:00Z') : null;
    const target = await slot('2026-10-20T10:00:00Z');
    const values = {
      clinicName: clinic.settings.clinicName,
      timeZone: clinic.settings.timeZone,
      lateCancellationHours: clinic.settings.lateCancellationHours,
      includeContactInConfirmation: clinic.settings.includeContactInConfirmation,
      remindersEnabled: false,
    };
    await updateAdminSettings(database.db, clock, values);
    const concurrent = createDatabase(database.url, { application_name: 'reminder-booking-transition' });
    let release!: () => void;
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const reachedTransition = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const enabling = database.db.transaction(async (tx) => {
      await updateAdminSettings(tx, clock, { ...values, remindersEnabled: true });
      // The skip update is finished, but the enabling transaction has not committed.
      reached();
      await proceed;
    });
    await reachedTransition;
    let completed = false;
    const changing = (
      existing
        ? rescheduleBooking(
            { ...deps(), db: concurrent.db },
            { patientId: existing.patientId, bookingId: existing.id, newSlotId: target },
          )
        : bookSlot({ ...deps(), db: concurrent.db }, { patientId: clinic.patient1.id, slotId: target })
    ).then((result) => {
      completed = true;
      return result;
    });
    try {
      await vi.waitFor(
        async () => {
          const waiting = await database.handle.pool.query(
            "select pid from pg_stat_activity where application_name = 'reminder-booking-transition' and wait_event_type = 'Lock'",
          );
          expect(completed || waiting.rowCount === 1).toBe(true);
        },
        { timeout: 5000, interval: 20 },
      );
      expect(completed, 'a booking must not commit inside the off-to-on transition').toBe(false);
    } finally {
      release();
      await enabling;
      await changing;
      await concurrent.pool.end();
    }
    // The booking serialised after enabling, so it is eligible for one reminder.
    smtp.messages.length = 0;
    await sendDueReminders(deps());
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
  });

  it.each(['create', 'move'] as const)(
    'skips a %s committed while off before re-enabling can finish',
    async (operation) => {
      const existing = operation === 'move' ? await book('2026-10-22T08:00:00Z') : null;
      const target = await slot('2026-10-20T10:00:00Z');
      const values = {
        clinicName: clinic.settings.clinicName,
        timeZone: clinic.settings.timeZone,
        lateCancellationHours: clinic.settings.lateCancellationHours,
        includeContactInConfirmation: clinic.settings.includeContactInConfirmation,
        remindersEnabled: false,
      };
      await updateAdminSettings(database.db, clock, values);
      const concurrent = createDatabase(database.url, { application_name: 'reminder-enabling-transition' });
      let release!: () => void;
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached!: () => void;
      const reachedBooking = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const original = database.db.transaction.bind(database.db);
      const pause = vi.spyOn(database.db, 'transaction').mockImplementationOnce((body, config) =>
        original(async (tx) => {
          const result = await body(tx);
          // The booking has been inserted/moved while off, but is not committed yet.
          reached();
          await proceed;
          return result;
        }, config),
      );
      const changing = existing
        ? rescheduleBooking(deps(), { patientId: existing.patientId, bookingId: existing.id, newSlotId: target })
        : bookSlot(deps(), { patientId: clinic.patient1.id, slotId: target });
      await reachedBooking;
      let completed = false;
      const enabling = updateAdminSettings(concurrent.db, clock, { ...values, remindersEnabled: true }).then(() => {
        completed = true;
      });
      try {
        await vi.waitFor(
          async () => {
            const waiting = await database.handle.pool.query(
              "select pid from pg_stat_activity where application_name = 'reminder-enabling-transition' and wait_event_type = 'Lock'",
            );
            expect(completed || waiting.rowCount === 1).toBe(true);
          },
          { timeout: 5000, interval: 20 },
        );
        expect(completed, 'enabling must wait for an in-flight booking made while off').toBe(false);
      } finally {
        release();
        await changing;
        await enabling;
        pause.mockRestore();
        await concurrent.pool.end();
      }
      const booking = await changing;
      const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row!.reminderSkippedAt).not.toBeNull();
      smtp.messages.length = 0;
      await sendDueReminders(deps());
      expect(smtp.messages).toHaveLength(0);
    },
  );

  it('does not skip a booking that becomes due only after reminders are switched back on', async () => {
    await book('2026-10-22T08:00:00Z');
    await database.db.update(clinicSettings).set({ remindersEnabled: false });
    await sendDueReminders(deps());
    await database.db.update(clinicSettings).set({ remindersEnabled: true });
    clock.set('2026-10-21T08:00:00Z');
    smtp.messages.length = 0;
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(1);
  });

  it('keeps a due reminder skipped when staff switch off after claiming but before delivery', async () => {
    const booking = await book();
    clock.set('2026-10-20T08:00:00Z');
    smtp.messages.length = 0;
    const blocker = await database.handle.pool.connect();
    let sending: Promise<void> | undefined;
    try {
      await blocker.query('begin');
      await blocker.query('select id from clinic_settings where id = 1 for update');
      sending = sendDueReminders(deps());
      await vi.waitFor(
        async () => {
          const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
          expect(row!.reminderAttemptedAt).not.toBeNull();
        },
        { timeout: 5000, interval: 20 },
      );
      await blocker.query('update clinic_settings set reminders_enabled = false where id = 1');
      await blocker.query('commit');
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await sending;
    }
    expect(smtp.messages).toHaveLength(0);
    await database.db.update(clinicSettings).set({ remindersEnabled: true });
    await sendDueReminders(deps());
    expect(smtp.messages).toHaveLength(0);
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

// Captured from sf-base's real seedTenant on disposable databases. The fixture
// retains booked slots and replaces password hashes with inert placeholders.
it.each(['acme', 'beacon'] as const)(
  'migrates and reseeds the previous %s clinic without resetting saved data',
  async (name) => {
    const server = await databaseOn(database.url);
    const folder = await mkdtemp(path.join(tmpdir(), 'bookit-reminder-migration-'));
    const pool = new Pool({ connectionString: server.url });
    const upgraded = createDatabase(server.url);
    const tenant = loadTenant(name);
    const passwords = Object.fromEntries(tenant.accounts.map((account) => [account.email, 'migration-only-password']));
    const snapshot: Record<string, Record<string, unknown>[]> = previousSeeds[name];
    try {
      for (const file of await readdir(MIGRATIONS_FOLDER))
        await cp(path.join(MIGRATIONS_FOLDER, file), path.join(folder, file), { recursive: true });
      const journalPath = path.join(folder, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { idx: number }[] };
      journal.entries = journal.entries.filter((entry) => entry.idx < 2);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(drizzle(pool), { migrationsFolder: folder });
      await pool.query(`create table bookit_seed_state (
      singleton boolean primary key check (singleton), tenant text not null,
      environment text not null, fingerprint text not null, seeded_at timestamptz not null
    )`);
      for (const table of ['user', 'practitioner', 'slot', 'booking', 'clinic_settings', 'bookit_seed_state']) {
        await pool.query(`insert into "${table}" select * from json_populate_recordset(null::"${table}", $1::json)`, [
          JSON.stringify(snapshot[table]),
        ]);
      }
      await runMigrations(server.url);
      expect(await seedTenant(upgraded.db, clock, { tenant, environment: 'staging', passwords })).toMatchObject({
        outcome: 'unchanged',
        counts: { users: 4, practitioners: 1, slots: 3, bookings: 3 },
      });
      await assertSeedIdentity(upgraded.db, name, 'staging');
      // Idempotent reseeding preserves credentials, bookings, settings and seed identity.
      for (const table of ['user', 'practitioner', 'slot', 'booking', 'clinic_settings', 'bookit_seed_state']) {
        const rows = JSON.parse(JSON.stringify((await pool.query(`select * from "${table}" order by 1`)).rows));
        const expected = snapshot[table]!.map((row) =>
          table === 'booking'
            ? { ...row, reminder_attempted_at: null, reminder_skipped_at: null }
            : table === 'clinic_settings'
              ? { ...row, reminders_enabled: true }
              : row,
        );
        expect(rows, table).toEqual(expected);
      }
      for (const input of [
        { tenant, environment: 'production', passwords },
        { tenant: loadTenant(name === 'acme' ? 'beacon' : 'acme'), environment: 'staging', passwords },
        {
          tenant: { ...tenant, settings: { ...tenant.settings, sessionMinutes: tenant.settings.sessionMinutes + 5 } },
          environment: 'staging',
          passwords,
        },
      ]) {
        // Supply matching passwords even for the other clinic so the identity check is exercised.
        const supplied = Object.fromEntries(
          input.tenant.accounts.map((account) => [account.email, 'migration-only-password']),
        );
        await expect(seedTenant(upgraded.db, clock, { ...input, passwords: supplied })).rejects.toThrow(
          'identity or configuration differs',
        );
      }
    } finally {
      await upgraded.pool.end();
      await pool.end();
      await server.stop();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
