import { createServer, type Socket } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { bookings } from '@/db/schema';
import { bookingReturnPath } from '@/lib/routes';
import { addDays, addHours } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, disabledMailer } from '@/server/notifications/mailer';
import { sendDueReminders } from '@/server/notifications/reminders';
import { loadClinicSettings, saveClinicSettings } from '@/server/settings';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { recordingMailer, testMail, type RecordingMailer } from '../helpers/mail';

const seedTime = '2026-10-20T07:00:00Z';
const firstStart = '2026-10-22T08:00:00Z';
const nextStart = '2026-10-22T08:45:00Z';
const movedStart = '2026-10-27T09:00:00Z';
const publicUrl = new URL('https://acme.example.test');
const clock = manualClock(seedTime);
let database: TestDatabase;
let clinic: SeededClinic;
let mailer: RecordingMailer;
let logs: CapturedLogs;

beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => database?.stop());
beforeEach(async () => {
  clock.set(seedTime);
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 14 } });
  mailer = recordingMailer();
  logs = captureLogs(clock);
});

function bookingDeps() {
  return { db: database.db, clock, log: logs.log, mail: testMail(disabledMailer) };
}

function checkReminders(mail = testMail(mailer)) {
  return sendDueReminders({ ...bookingDeps(), mail, publicUrl });
}

async function slotIdAt(start: string) {
  const free = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: addDays(clock.now(), 14),
  });
  const slot = free.find((slot) => slot.startsAt.getTime() === Date.parse(start));
  if (!slot) throw new Error(`Expected a free slot at ${start}`);
  return slot.id;
}

async function bookAt(start: string, patientId = clinic.patient1.id) {
  return bookSlot(bookingDeps(), { patientId, slotId: await slotIdAt(start) });
}

it('sends one reminder to the client when their session is 24 hours away', async () => {
  const booking = await bookAt(firstStart);
  clock.set(addHours(booking.startsAt, -24));
  clock.advanceMinutes(-1);
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);

  clock.advanceMinutes(1);
  await Promise.all([checkReminders(), checkReminders()]);
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({
    to: clinic.patient1.email,
    subject: 'Session reminder for Thu, 22 Oct 2026, 09:00',
  });
  expect(mailer.sent[0]!.text).toMatch(
    /^Test Physio Clinic\n\nYour session with Pat Physio is on Thu, 22 Oct 2026, 09:00 \(UK time\)\./,
  );
});

it('shows one time in the clinic’s configured time zone in both email formats', async () => {
  const booking = await bookAt(firstStart);
  await saveClinicSettings(database.db, clock, { ...clinic.settings, timeZone: 'Europe/Paris' });
  clock.set(addHours(booking.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]!.subject).toBe('Session reminder for Thu, 22 Oct 2026, 10:00');
  for (const body of [mailer.sent[0]!.text, mailer.sent[0]!.html]) {
    expect(body).toContain('Thu, 22 Oct 2026, 10:00 (Europe/Paris).');
    expect(body?.match(/\b\d{2}:\d{2}\b/g)).toEqual(['10:00']);
  }
});

it('links the reminder to rescheduling and cancellation for the recipient’s booking', async () => {
  const booking = await bookAt(firstStart, clinic.patient2.id);
  clock.set(addHours(booking.startsAt, -24));
  await checkReminders();
  const [email] = mailer.sent;
  expect(email?.to).toBe(clinic.patient2.email);
  const reschedule = `/bookings/${booking.id}/reschedule`;
  const cancellation = `/bookings?booking=${booking.id}#cancel-${booking.id}`;
  expect(email?.text).toContain(`Reschedule your session: ${publicUrl.origin}${reschedule}`);
  expect(email?.text).toContain(`Cancel your session: ${publicUrl.origin}${cancellation}`);
  expect(email?.html).toContain(`href="${publicUrl.origin}${reschedule}">Reschedule your session</a>`);
  expect(email?.html).toContain(`href="${publicUrl.origin}${cancellation}">Cancel your session</a>`);
  expect(bookingReturnPath(reschedule)).toBe(reschedule);
  expect(bookingReturnPath(cancellation)).toBe(cancellation);
  await expect(findBookingForPatient(database.db, clinic.patient1.id, booking.id)).resolves.toBeNull();
  await expect(findBookingForPatient(database.db, clinic.patient2.id, booking.id)).resolves.toMatchObject({
    id: booking.id,
    status: 'confirmed',
  });
});

it('uses the moved time and leaves out cancelled sessions', async () => {
  const original = await bookAt(firstStart);
  const cancelled = await bookAt(nextStart, clinic.patient2.id);
  await cancelBooking(bookingDeps(), { patientId: clinic.patient2.id, bookingId: cancelled.id });
  const moved = await rescheduleBooking(bookingDeps(), {
    patientId: clinic.patient1.id,
    bookingId: original.id,
    newSlotId: await slotIdAt(movedStart),
  });
  clock.set(addHours(original.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);
  clock.set(addHours(cancelled.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);

  clock.set(addHours(moved.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]!.text).toContain('Tue, 27 Oct 2026, 09:00 (UK time)');
});

it('skips bookings and moves made after the reminder was due', async () => {
  const original = await bookAt(movedStart, clinic.patient2.id);
  clock.set(addHours(new Date(firstStart), -24));
  clock.advanceMinutes(1);
  await bookAt(firstStart);
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);

  clock.set(addHours(new Date(nextStart), -24));
  clock.advanceMinutes(1);
  await rescheduleBooking(bookingDeps(), {
    patientId: clinic.patient2.id,
    bookingId: original.id,
    newSlotId: await slotIdAt(nextStart),
  });
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);
});

it.each(['move', 'cancellation'] as const)(
  'discards a claimed reminder when a %s wins before mail handoff',
  async (change) => {
    const booking = await bookAt(firstStart);
    clock.set(addHours(booking.startsAt, -24));
    const request = { patientId: clinic.patient1.id, bookingId: booking.id };
    const claim = async () => {
      const [row] = await database.db
        .select({ at: bookings.reminderClaimedAt })
        .from(bookings)
        .where(eq(bookings.id, booking.id));
      return row!.at;
    };
    const transaction = database.db.transaction.bind(database.db);
    const beforeHandoff = vi.spyOn(database.db, 'transaction').mockImplementationOnce(async (work, config) => {
      expect(await claim()).toEqual(clock.now());
      if (change === 'move') {
        await rescheduleBooking(bookingDeps(), { ...request, newSlotId: await slotIdAt(movedStart) });
      } else {
        await cancelBooking(bookingDeps(), request);
      }
      return transaction(work, config);
    });
    try {
      await checkReminders();
      expect(beforeHandoff).toHaveBeenCalled();
      expect(mailer.sent).toHaveLength(0);
      expect(await claim()).toBeNull();
    } finally {
      beforeHandoff.mockRestore();
    }
    if (change === 'move') {
      clock.set(addHours(new Date(movedStart), -24));
      await checkReminders();
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.text).toContain('Tue, 27 Oct 2026, 09:00 (UK time)');
    }
  },
);

it.each(['move', 'cancellation', 'switch-off'] as const)(
  'holds the %s until the mailer returns its acceptance',
  async (change) => {
    const booking = await bookAt(firstStart);
    const newSlotId = await slotIdAt(movedStart);
    clock.set(addHours(booking.startsAt, -24));
    let startSubmission!: () => void;
    let acceptMessage!: () => void;
    const submitting = new Promise<void>((resolve) => {
      startSubmission = resolve;
    });
    const acceptance = new Promise<void>((resolve) => {
      acceptMessage = resolve;
    });
    const recording = mailer;
    mailer = {
      ...recording,
      send: async (message) => {
        startSubmission();
        await acceptance;
        return recording.send(message);
      },
    };

    const reminder = checkReminders();
    await Promise.race([
      submitting,
      reminder.then(() => {
        throw new Error('No mail submission');
      }),
    ]);
    const request = { patientId: clinic.patient1.id, bookingId: booking.id };
    const attempted =
      change === 'move'
        ? rescheduleBooking(bookingDeps(), { ...request, newSlotId })
        : change === 'cancellation'
          ? cancelBooking(bookingDeps(), request)
          : saveClinicSettings(database.db, clock, { ...clinic.settings, reminderEmailsEnabled: false });
    try {
      // Observe the actual database lock wait. A delayed application response
      // alone would not prove that the new booking or setting is still private.
      await expect
        .poll(
          async () => {
            const { rows } = await database.db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1 from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()
          ) as waiting
        `);
            return rows[0]?.waiting;
          },
          { timeout: 3_000 },
        )
        .toBe(true);
      expect(mailer.sent).toHaveLength(0);
      const unchanged = await findBookingForPatient(database.db, clinic.patient1.id, booking.id);
      expect(unchanged).toMatchObject({ slotId: booking.slotId, status: 'confirmed' });
      expect((await loadClinicSettings(database.db)).reminderEmailsEnabled).toBe(true);
    } finally {
      acceptMessage();
      await Promise.all([reminder, attempted]);
    }
    const current = await findBookingForPatient(database.db, clinic.patient1.id, booking.id);
    expect(current?.slotId).toBe(change === 'move' ? newSlotId : booking.slotId);
    expect(current?.status).toBe(change === 'cancellation' ? 'cancelled' : 'confirmed');
    expect((await loadClinicSettings(database.db)).reminderEmailsEnabled).toBe(change !== 'switch-off');
    expect(mailer.sent).toHaveLength(1);
  },
);

it('does not send a second reminder when a reminded booking moves', async () => {
  const original = await bookAt(firstStart);
  clock.set(addHours(original.startsAt, -24));
  await checkReminders();
  const moved = await rescheduleBooking(bookingDeps(), {
    patientId: clinic.patient1.id,
    bookingId: original.id,
    newSlotId: await slotIdAt(movedStart),
  });
  clock.set(addHours(moved.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]!.text).toContain('Thu, 22 Oct 2026, 09:00 (UK time)');
});

it('observes the clinic setting and does not catch up reminders once their window has closed', async () => {
  const missed = await bookAt(firstStart);
  const upcoming = await bookAt(nextStart, clinic.patient2.id);
  await saveClinicSettings(database.db, clock, { ...clinic.settings, reminderEmailsEnabled: false });
  clock.set(addHours(missed.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);

  clock.set(addHours(upcoming.startsAt, -24));
  await saveClinicSettings(database.db, clock, { ...clinic.settings, reminderEmailsEnabled: true });
  await checkReminders();
  expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient2.email]);
});

it('retries within the reminder window when SMTP refused the connection', async () => {
  const booking = await bookAt(firstStart);
  clock.set(addHours(booking.startsAt, -24));
  await checkReminders(testMail(createSmtpMailer('smtp://127.0.0.1:9')));
  expect(logs.events()).toContain('email.reminder.failed');
  clock.advanceMinutes(1);
  await checkReminders();
  await checkReminders();
  expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient1.email]);
});

it('retries within the reminder window after a failure in the final database check', async () => {
  const booking = await bookAt(firstStart);
  clock.set(addHours(booking.startsAt, -24));
  const finalCheck = vi.spyOn(database.db, 'transaction').mockRejectedValueOnce(new Error('Database unavailable'));
  try {
    await expect(checkReminders()).rejects.toThrow('Database unavailable');
    expect(mailer.sent).toHaveLength(0);
  } finally {
    finalCheck.mockRestore();
  }
  clock.advanceMinutes(1);
  await checkReminders();
  expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient1.email]);
});

it('retries after timing out before the SMTP greeting', async () => {
  const booking = await bookAt(firstStart);
  clock.set(addHours(booking.startsAt, -24));
  const sockets: Socket[] = [];
  const silentServer = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
  try {
    const address = silentServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local TCP server');
    await checkReminders(testMail(createSmtpMailer(`smtp://127.0.0.1:${address.port}?greetingTimeout=50`)));
    expect(sockets).toHaveLength(1);
    expect(logs.events()).toContain('email.reminder.failed');
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => silentServer.close(() => resolve()));
  }
  clock.advanceMinutes(1);
  await checkReminders();
  expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient1.email]);
});

it('does not retry when the mail server may already have accepted a reminder', async () => {
  const booking = await bookAt(firstStart);
  clock.set(addHours(booking.startsAt, -24));
  const acceptingMailer = mailer;
  mailer = {
    ...acceptingMailer,
    send: async (email) => {
      await acceptingMailer.send(email);
      throw Object.assign(new Error('Connection lost after accepting the message'), {
        code: 'ESOCKET',
        command: 'CONN',
        syscall: 'read',
      });
    },
  };
  await checkReminders();
  expect(logs.events()).toContain('email.reminder.failed');
  mailer = acceptingMailer;
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
});
