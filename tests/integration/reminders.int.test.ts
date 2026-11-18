import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { bookings, clinicSettings, slots } from '@/db/schema';
import { addHours, addMinutes } from '@/lib/time';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { disabledMailer, type Mailer } from '@/server/notifications/mailer';
import { sendDueBookingReminders } from '@/server/notifications/reminders';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

const start = '2026-10-20T07:00:00Z';
const clock = manualClock(start);
let database: TestDatabase;
let clinic: SeededClinic;

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  clock.set(start);
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
});

function reminderDeps(mailer: Mailer, tenant = 'acme') {
  return {
    db: database.db,
    clock,
    mail: testMail(mailer),
    log: captureLogs(clock).log,
    tenant,
    publicUrl: new URL(`https://${tenant}.clinic.example.test`),
  };
}

async function setReminders(enabled: boolean) {
  await database.db.update(clinicSettings).set({ remindersEnabled: enabled }).where(eq(clinicSettings.id, 1));
}

async function slotAt(instant: string) {
  const [slot] = await database.db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.practitionerId, clinic.practitioners.weekdays), eq(slots.startsAt, new Date(instant))));
  return slot!.id;
}

async function bookAt(instant: string, patientId = clinic.patient1.id) {
  return bookSlot(reminderDeps(disabledMailer), { patientId, slotId: await slotAt(instant) });
}

async function duringBookingDetailsRead(work: () => Promise<unknown>, whileWaiting: (pid: number) => Promise<void>) {
  const blocker = await database.handle.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query('begin');
    await blocker.query('lock table "practitioner" in access exclusive mode');
    pending = work();
    void pending.catch(() => undefined);
    let pid: number | undefined;
    await expect
      .poll(
        async () => {
          const { rows } = await database.db.execute<{ pid: number }>(sql`
            select pid from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and query like '%inner join "practitioner"%'
          `);
          pid = rows[0]?.pid;
          return pid;
        },
        { timeout: 5_000 },
      )
      .toBeTypeOf('number');
    await whileWaiting(pid!);
  } finally {
    await blocker.query('rollback').finally(() => blocker.release());
    await pending;
  }
}

it('Sends a confirmed booking one reminder when due, even across concurrent checks and later checks', async () => {
  const booking = await bookAt('2026-10-22T13:15:00Z');
  await setReminders(true);
  const inbox = recordingMailer();
  const first = reminderDeps(inbox);
  const second = reminderDeps(inbox);
  clock.set(addMinutes(addHours(booking.startsAt, -24), -1));
  await sendDueBookingReminders(first);
  expect(inbox.sent).toEqual([]);

  clock.advanceMinutes(1);
  await Promise.all([sendDueBookingReminders(first), sendDueBookingReminders(second)]);
  expect(inbox.sent).toHaveLength(1);
  expect(inbox.sent[0]?.to).toBe(clinic.patient1.email);

  clock.advanceMinutes(15);
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toHaveLength(1);
});

it('Shows the date, local 24-hour time and practitioner in the reminder on both sides of the clock change', async () => {
  const summer = await bookAt('2026-10-22T13:15:00Z');
  const winter = await bookAt('2026-10-26T13:30:00Z');
  await setReminders(true);
  const inbox = recordingMailer();

  clock.set(addHours(summer.startsAt, -24));
  await sendDueBookingReminders(reminderDeps(inbox, 'acme'));
  expect(inbox.sent[0]?.text).toContain(
    'Test Physio Clinic\n\nYour session is on Thu, 22 Oct 2026, 14:15 (Europe/London) with your physiotherapist, Pat Physio.',
  );
  expect(inbox.sent[0]?.html).toContain('with your physiotherapist, Pat Physio.');

  clock.set(addHours(winter.startsAt, -24));
  await sendDueBookingReminders(reminderDeps(inbox, 'beacon'));
  expect(inbox.sent[1]?.text).toContain(
    'Test Physio Clinic\n\nYour appointment is on Mon, 26 Oct 2026, 13:30 (Europe/London) with your clinician, Pat Physio.',
  );
  expect(inbox.sent[1]?.html).toContain('with your clinician, Pat Physio.');
});

it('Omits cancelled, past and short-notice bookings from the reminder emails', async () => {
  const old = await bookAt('2026-10-21T08:00:00Z');
  const cancelled = await bookAt('2026-10-22T13:15:00Z');
  await cancelBooking(reminderDeps(disabledMailer), { bookingId: cancelled.id, patientId: cancelled.patientId });
  await setReminders(true);
  clock.set(addHours(cancelled.startsAt, -24));
  expect(old.startsAt < clock.now()).toBe(true);
  await bookAt('2026-10-21T14:45:00Z');
  const inbox = recordingMailer();
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toEqual([]);
});

it('Uses the new time of a moved booking and sends no further reminder if it moves again', async () => {
  const original = await bookAt('2026-10-22T13:15:00Z');
  const deps = reminderDeps(disabledMailer);
  const moved = await rescheduleBooking(deps, {
    bookingId: original.id,
    patientId: original.patientId,
    newSlotId: await slotAt('2026-10-23T13:15:00Z'),
  });
  await setReminders(true);
  const inbox = recordingMailer();

  clock.set(addHours(original.startsAt, -24));
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toEqual([]);

  clock.set(addHours(moved.startsAt, -24));
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toHaveLength(1);
  expect(inbox.sent[0]?.text).toContain('Fri, 23 Oct 2026, 14:15');

  const movedAgain = await rescheduleBooking(deps, {
    bookingId: moved.id,
    patientId: moved.patientId,
    newSlotId: await slotAt('2026-10-26T13:30:00Z'),
  });
  clock.set(addHours(movedAgain.startsAt, -24));
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toHaveLength(1);
});

it('Leaves due reminders unsent and eligible while clinic reminders are off', async () => {
  const booking = await bookAt('2026-10-22T13:15:00Z');
  const inbox = recordingMailer();
  const deps = reminderDeps(inbox);
  clock.set(addHours(booking.startsAt, -24));
  await sendDueBookingReminders(deps);
  expect(inbox.sent).toEqual([]);

  await setReminders(true);
  await sendDueBookingReminders(deps);
  expect(inbox.sent).toHaveLength(1);

  await setReminders(false);
  const other = await bookAt('2026-10-23T13:15:00Z', clinic.patient2.id);
  clock.set(addHours(other.startsAt, -24));
  await sendDueBookingReminders(deps);
  expect(inbox.sent).toHaveLength(1);
});

it('Does not resend if SMTP disconnects after taking the reminder email', async () => {
  const booking = await bookAt('2026-10-22T13:15:00Z');
  clock.set(addHours(booking.startsAt, -24));
  await setReminders(true);
  const inbox = recordingMailer();
  const disconnected: Mailer = {
    kind: 'recording',
    async send(email) {
      await inbox.send(email);
      throw new Error('SMTP disconnected before acknowledging the message');
    },
  };
  await sendDueBookingReminders(reminderDeps(disconnected));
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toHaveLength(1);
  const [stored] = await database.db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, booking.id));
  expect(stored?.status).toBe('confirmed');
});

it('Honours a staff switch to off while the scheduler is reading the due booking', async () => {
  const booking = await bookAt('2026-10-22T13:15:00Z');
  clock.set(addHours(booking.startsAt, -24));
  await setReminders(true);
  const inbox = recordingMailer();

  await duringBookingDetailsRead(
    () => sendDueBookingReminders(reminderDeps(inbox)),
    async () => {
      const { clinicName, timeZone, lateCancellationHours, includeContactInConfirmation } = clinic.settings;
      await updateAdminSettings(database.db, clock, {
        clinicName,
        timeZone,
        lateCancellationHours,
        includeContactInConfirmation,
        remindersEnabled: false,
      });
    },
  );
  expect(inbox.sent).toEqual([]);
  await setReminders(true);
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toHaveLength(1);
});

it('Retries a due reminder after PostgreSQL interrupts the booking details read before SMTP', async () => {
  const booking = await bookAt('2026-10-22T13:15:00Z');
  clock.set(addHours(booking.startsAt, -24));
  await setReminders(true);
  const inbox = recordingMailer();

  await duringBookingDetailsRead(
    () => expect(sendDueBookingReminders(reminderDeps(inbox))).rejects.toMatchObject({ cause: { code: '57014' } }),
    async (pid) => {
      const [result] = (
        await database.db.execute<{ cancelled: boolean }>(sql`select pg_cancel_backend(${pid}) as cancelled`)
      ).rows;
      expect(result?.cancelled).toBe(true);
    },
  );
  expect(inbox.sent).toEqual([]);
  await sendDueBookingReminders(reminderDeps(inbox));
  expect(inbox.sent).toHaveLength(1);
});
