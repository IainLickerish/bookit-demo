import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Executor, Transaction } from '@/db/client';
import { bookings, clinicSettings } from '@/db/schema';
import { addHours, addMinutes } from '@/lib/time';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import type { BookingView } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, type Mailer } from '@/server/notifications/mailer';
import { sendDueBookingReminders } from '@/server/notifications/reminders';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { recordingMailer, startSmtpReceiver, testMail, type SmtpReceiver } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
let clinic: SeededClinic;
let logs: CapturedLogs;
let smtp: SmtpReceiver;

beforeAll(async () => {
  database = await startTestDatabase();
  smtp = await startSmtpReceiver();
});

afterAll(async () => {
  await smtp?.stop();
  await database?.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  smtp.messages.length = 0;
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 10 } });
  logs = captureLogs(clock);
});

function deps(mailer?: Mailer) {
  return {
    db: database.db,
    clock,
    log: logs.log,
    mail: testMail(mailer),
    publicUrl: new URL('https://clinic.example.test'),
  };
}

async function slotAt(instant: string, practitionerId = clinic.practitioners.weekdays) {
  const start = new Date(instant);
  const [slot] = await listAvailableSlots(database.db, {
    practitionerId,
    after: addMinutes(start, -1),
    until: start,
  });
  if (!slot || slot.startsAt.getTime() !== start.getTime()) throw new Error('Fixture slot is unavailable');
  return slot.id;
}

async function bookAt(instant: string, patientId = clinic.patient1.id) {
  return bookSlot(deps(), { patientId, slotId: await slotAt(instant) });
}

function setReminders(db: Executor, sendBookingReminders: boolean) {
  const { clinicName, timeZone, lateCancellationHours, includeContactInConfirmation } = clinic.settings;
  return updateAdminSettings(db, clock, {
    clinicName,
    timeZone,
    lateCancellationHours,
    includeContactInConfirmation,
    sendBookingReminders,
  });
}

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

async function updateBeforeHandoff(bookingId: string, mailer: Mailer, update: (tx: Transaction) => Promise<unknown>) {
  let poll: Promise<void> | undefined;
  try {
    await database.db.transaction(async (tx) => {
      // The worker can reserve the attempt, but must wait for this lock before handing off the email.
      await tx.select({ id: clinicSettings.id }).from(clinicSettings).for('update');
      poll = sendDueBookingReminders(deps(mailer));
      await vi.waitFor(async () => {
        const [booking] = await tx
          .select({ attempt: bookings.reminderAttemptedAt })
          .from(bookings)
          .where(eq(bookings.id, bookingId));
        expect(booking?.attempt).toEqual(clock.now());
      });
      await update(tx);
    });
  } finally {
    await poll;
  }
}

describe('booking reminders', () => {
  it('sends only one reminder at 24 hours, with the UK date, time and physiotherapist', async () => {
    const { startsAt } = await bookAt('2026-10-22T08:00:00Z');
    const mail = deps(createSmtpMailer(smtp.url));
    clock.set(addMinutes(addHours(startsAt, -24), -1));
    await sendDueBookingReminders(mail);
    expect(smtp.messages).toHaveLength(0);

    clock.advanceMinutes(1);
    await Promise.all([sendDueBookingReminders(mail), sendDueBookingReminders(mail)]);
    clock.advanceMinutes(1);
    await sendDueBookingReminders(mail);
    expect(smtp.messages).toHaveLength(1);
    const [message] = smtp.messages;
    const unfolded = message!.raw.replace(/=\r?\n/g, '');
    expect(message!.to).toEqual([clinic.patient1.email]);
    expect(unfolded).toMatch(/\r?\n\r?\nTest Physio Clinic\r?\n/);
    expect(unfolded).toContain('Thu, 22 Oct 2026, 09:00 (Europe/London)');
    expect(unfolded).toContain('With Pat Physio, your physiotherapist');
  });

  it('skips a session booked after the reminder window', async () => {
    clock.set('2026-10-21T09:01:00Z');
    await bookAt('2026-10-22T08:00:00Z');
    const mailer = recordingMailer();
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(0);
  });

  it('skips cancelled and started sessions and sends the moved session at its new time', async () => {
    const cancelled = await bookAt('2026-10-22T08:00:00Z');
    const moved = await bookAt('2026-10-22T08:45:00Z', clinic.patient2.id);
    await bookAt('2026-10-21T08:00:00Z');
    await cancelBooking(deps(), { bookingId: cancelled.id, patientId: cancelled.patientId });
    const moveRequest = { bookingId: moved.id, patientId: moved.patientId };
    const newSlotId = await slotAt('2026-10-27T10:00:00Z', clinic.practitioners.saturdays);
    const newBooking = await rescheduleBooking(deps(), { ...moveRequest, newSlotId });

    const mailer = recordingMailer();
    clock.set(addHours(moved.startsAt, -24));
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(0);

    clock.set(addHours(newBooking.startsAt, -24));
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: clinic.patient2.email });
    expect(mailer.sent[0]!.text).toContain('Tue, 27 Oct 2026, 10:00 (Europe/London)');
    expect(mailer.sent[0]!.text).toContain('With Sam Sports, your physiotherapist');

    const laterSlotId = await slotAt('2026-10-28T09:00:00Z');
    const later = await rescheduleBooking(deps(), { ...moveRequest, newSlotId: laterSlotId });
    clock.set(addHours(later.startsAt, -24));
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(1);
  });

  it('stops and resumes due reminders when staff change the clinic setting', async () => {
    const booking = await bookAt('2026-10-22T08:00:00Z');
    const mailer = recordingMailer();
    clock.set(addHours(booking.startsAt, -24));

    await updateBeforeHandoff(booking.id, mailer, (tx) => setReminders(tx, false));
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(0);

    await setReminders(database.db, true);
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(clinic.patient1.email);
  });

  it('uses the new session time when a move commits after reservation and before hand-off', async () => {
    const booking = await bookAt('2026-10-22T08:00:00Z');
    const newSlotId = await slotAt('2026-10-23T08:45:00Z');
    const mailer = recordingMailer();
    clock.set(addHours(booking.startsAt, -24));
    await updateBeforeHandoff(booking.id, mailer, () =>
      rescheduleBooking(deps(), { bookingId: booking.id, patientId: booking.patientId, newSlotId }),
    );
    expect(mailer.sent).toHaveLength(0);

    clock.set('2026-10-22T08:45:00Z');
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain('Fri, 23 Oct 2026, 09:45 (Europe/London)');
  });

  it('skips the email when cancellation commits after reservation and before hand-off', async () => {
    const booking = await bookAt('2026-10-22T08:00:00Z');
    const mailer = recordingMailer();
    clock.set(addHours(booking.startsAt, -24));
    await updateBeforeHandoff(booking.id, mailer, async () => {
      const cancellation = await cancelBooking(deps(), { bookingId: booking.id, patientId: booking.patientId });
      expect(cancellation.booking.status).toBe('cancelled');
    });
    expect(mailer.sent).toHaveLength(0);
  });

  const changesDuringDelivery = {
    'moving the session': async ({ id, patientId }: BookingView) =>
      rescheduleBooking(deps(), { bookingId: id, patientId, newSlotId: await slotAt('2026-10-23T08:45:00Z') }),
    'cancelling the session': ({ id, patientId }: BookingView) => cancelBooking(deps(), { bookingId: id, patientId }),
    'turning reminders off': () => setReminders(database.db, false),
  };

  it.each(Object.entries(changesDuringDelivery))('waits for SMTP acceptance before %s', async (_name, change) => {
    const booking = await bookAt('2026-10-22T08:00:00Z');
    clock.set(addHours(booking.startsAt, -24));
    const received = deferredSignal();
    const accept = deferredSignal();
    const receiver = await startSmtpReceiver(() => {
      received.resolve();
      return accept.promise;
    });
    const poll = sendDueBookingReminders(deps(createSmtpMailer(receiver.url, 5_000)));
    let changeResult: Promise<unknown> | undefined;
    try {
      await Promise.race([received.promise, poll]);
      changeResult = change(booking);
      await vi.waitFor(async () => {
        const waiting = await database.db.execute(
          sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
        );
        expect(waiting.rows).toHaveLength(1);
      });
      expect(receiver.messages).toHaveLength(0);
    } finally {
      accept.resolve();
      await Promise.all([poll, changeResult]);
      await receiver.stop();
    }
    expect(receiver.messages).toHaveLength(1);
    expect(logs.events()).toContain('email.reminder.sent');
  });

  it('releases the booking lock after an SMTP receiver takes too long to accept', async () => {
    const booking = await bookAt('2026-10-22T08:00:00Z');
    clock.set(addHours(booking.startsAt, -24));
    const received = deferredSignal();
    const accept = deferredSignal();
    const receiver = await startSmtpReceiver(() => {
      received.resolve();
      return accept.promise;
    });
    const poll = sendDueBookingReminders(deps(createSmtpMailer(receiver.url, 1_000)));
    try {
      await Promise.race([received.promise, poll]);
      const cancellation = await cancelBooking(deps(), { bookingId: booking.id, patientId: booking.patientId });
      expect(cancellation.booking.status).toBe('cancelled');
      await poll;
      expect(receiver.messages).toHaveLength(0);
      expect(logs.events().slice(-2)).toEqual(['email.reminder.failed', 'booking.cancelled']);
    } finally {
      accept.resolve();
      await poll;
      await receiver.stop();
    }
  });

  it('does not retry when delivery may have succeeded before reporting a failure', async () => {
    const booking = await bookAt('2026-10-22T08:00:00Z');
    const mailer = recordingMailer();
    const uncertainMailer: Mailer = {
      kind: 'recording',
      async send(email) {
        await mailer.send(email);
        throw new Error(`Lost the SMTP reply for ${email.to}`);
      },
    };
    clock.set(addHours(booking.startsAt, -24));
    await sendDueBookingReminders(deps(uncertainMailer));
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(1);
    expect(logs.events()).toContain('email.reminder.failed');
    expect(JSON.stringify(logs.lines)).not.toContain(clinic.patient1.email);
  });
});
