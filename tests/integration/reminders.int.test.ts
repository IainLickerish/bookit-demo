import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookings, slots } from '@/db/schema';
import { newId } from '@/lib/ids';
import { addHours, addMinutes } from '@/lib/time';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, disabledMailer, type Mailer } from '@/server/notifications/mailer';
import { sendDueReminders } from '@/server/notifications/reminders';
import { loadClinicSettings, saveClinicSettings } from '@/server/settings';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, startSmtpReceiver, testMail, type SmtpReceiver } from '../helpers/mail';

let database: TestDatabase;
let otherDatabase: TestDatabase;
let clinic: SeededClinic;
let smtp: SmtpReceiver;
const clock = manualClock('2026-10-20T07:00:00Z');
let mailer = recordingMailer();
let logs = captureLogs(clock);
const deps = (transport: Mailer = mailer) => ({
  db: database.db,
  clock,
  log: logs.log,
  mail: testMail(transport),
  publicUrl: new URL('https://clinic.test'),
  tenant: 'acme',
});

async function makeBooking(hoursAhead = 24, patientId = clinic.patient1.id, minutes = 45) {
  const id = newId(clock);
  const start = addHours(clock.now(), hoursAhead);
  await database.db.insert(slots).values({
    id,
    practitionerId: clinic.practitioners.weekdays,
    startsAt: start,
    endsAt: addMinutes(start, minutes),
    createdAt: clock.now(),
  });
  return bookSlot(deps(), { patientId, slotId: id, phone: '+44 7700 900001' });
}
async function stored(id: string) {
  const [row] = await database.db.select().from(bookings).where(eq(bookings.id, id));
  return row!;
}
async function setEnabled(remindersEnabled: boolean) {
  await updateAdminSettings(database.db, clock, { ...editable(), remindersEnabled });
}
function editable() {
  return {
    clinicName: clinic.settings.clinicName,
    timeZone: clinic.settings.timeZone,
    lateCancellationHours: clinic.settings.lateCancellationHours,
    includeContactInConfirmation: false,
  };
}

beforeAll(async () => {
  database = await startTestDatabase(10);
  otherDatabase = await startTestDatabase();
  smtp = await startSmtpReceiver();
});
afterAll(async () => {
  await Promise.allSettled([database?.stop(), otherDatabase?.stop(), smtp?.stop()]);
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  mailer = recordingMailer();
  logs = captureLogs(clock);
});

describe('durable reminder delivery', () => {
  it.each([
    ['acme', '2026-10-24T09:00:00Z'],
    ['beacon', '2026-10-24T09:00:00Z'],
    ['acme', '2027-03-27T08:00:00Z'],
    ['beacon', '2027-03-27T08:00:00Z'],
  ])('selects only the elapsed-hour window for %s across the clock change at %s', async (tenant, instant) => {
    clock.set(instant);
    const candidates = [];
    for (const hours of [22.999, 23, 23.5, 24, 24.001]) {
      candidates.push({ hours, booking: await makeBooking(hours) });
    }
    mailer.sent.length = 0;
    expect(await sendDueReminders({ ...deps(), tenant })).toBe(3);
    expect(mailer.sent).toHaveLength(3);
    for (const { hours, booking } of candidates) {
      const due = hours >= 23 && hours <= 24;
      expect((await stored(booking.id)).reminderAttemptedAt).toEqual(due ? clock.now() : null);
      expect((await stored(booking.id)).reminderSentAt).toEqual(due ? clock.now() : null);
      expect(mailer.sent.filter((email) => email.text.includes(`/bookings/${booking.id}/`))).toHaveLength(due ? 1 : 0);
    }
    expect(await sendDueReminders({ ...deps(), tenant })).toBe(0);
  });

  it.each([
    ['acme', 'Acme Physio', '2026-10-24T09:00:00Z', 'Sun, 25 Oct 2026, 09:00', 45, 'physiotherapist'],
    ['beacon', 'Beacon Dental', '2027-03-27T08:00:00Z', 'Sun, 28 Mar 2027, 09:00', 30, 'clinician'],
  ] as const)(
    'sends a %s reminder through SMTP across the UK clock change',
    async (tenant, clinicName, now, when, minutes, practitioner) => {
      clock.set(now);
      await saveClinicSettings(database.db, clock, { ...clinic.settings, clinicName, sessionMinutes: minutes });
      const booking = await makeBooking(24, clinic.patient1.id, minutes);
      smtp.messages.length = 0;
      expect(await sendDueReminders({ ...deps(createSmtpMailer(smtp.url)), tenant })).toBe(1);
      expect(smtp.messages).toHaveLength(1);
      const message = smtp.messages[0]!;
      expect(message.to).toEqual([clinic.patient1.email]);
      const text = message.raw.replace(/=\r?\n/g, '');
      expect(text).toContain(`When: ${when} (UK time, Europe/London)`);
      expect(text).toContain(`Your ${practitioner}:`);
      expect(text).toContain(`Duration: ${minutes} minutes`);
      expect(text).toContain(`/bookings/${booking.id}/reschedule`);
      expect(text).toContain(`/bookings/${booking.id}/review`);
      expect(text).not.toContain('7700');
      expect((await stored(booking.id)).reminderSentAt).toEqual(clock.now());
    },
  );
  it('sends once across concurrent workers and repeated runs, without changing booking details', async () => {
    const booking = await makeBooking();
    const before = await stored(booking.id);
    mailer.sent.length = 0;
    expect(
      (await Promise.all(Array.from({ length: 5 }, () => sendDueReminders(deps())))).reduce((a, b) => a + b, 0),
    ).toBe(1);
    expect(await sendDueReminders(deps())).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).not.toContain('7700');
    expect(await stored(booking.id)).toEqual({
      ...before,
      reminderAttemptedAt: clock.now(),
      reminderSentAt: clock.now(),
    });
  });

  it('does not remind cancelled bookings, including late cancellations', async () => {
    const booking = await makeBooking(23.5);
    const result = await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id });
    expect(result).toMatchObject({ late: true, booking: { status: 'cancelled', lateCancellation: true } });
    const early = await makeBooking(24);
    await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: early.id });
    mailer.sent.length = 0;
    expect(await sendDueReminders(deps())).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('renews eligibility only after successful moves, including a move back to a previous time', async () => {
    const booking = await makeBooking(24);
    const target = await makeBooking(23.5, clinic.patient2.id);
    await cancelBooking(deps(), { patientId: clinic.patient2.id, bookingId: target.id });
    await sendDueReminders(deps());
    expect((await stored(booking.id)).reminderSentAt).not.toBeNull();
    const moved = await rescheduleBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target.slotId,
    });
    expect((await stored(booking.id)).reminderAttemptedAt).toBeNull();
    expect(await sendDueReminders(deps())).toBe(1);
    expect(await sendDueReminders(deps())).toBe(0);
    await rescheduleBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: booking.slotId,
    });
    expect(await sendDueReminders(deps())).toBe(1);
    expect(moved.rescheduleCount).toBe(1);
  });

  it('does not send for an old time after a move outside the window, then sends for the new time', async () => {
    const booking = await makeBooking(24);
    const target = await makeBooking(48, clinic.patient2.id);
    await cancelBooking(deps(), { patientId: clinic.patient2.id, bookingId: target.id });
    await rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target.slotId });
    expect(await sendDueReminders(deps())).toBe(0);
    clock.set(addHours(clock.now(), 24).toISOString());
    expect(await sendDueReminders(deps())).toBe(1);
    expect(mailer.sent.at(-1)!.text).toContain('Thu, 22 Oct 2026, 08:00');
  });

  it('preserves the original time and its unsent or sent reminder state after a failed move', async () => {
    const booking = await makeBooking(24);
    const taken = await makeBooking(23.5, clinic.patient2.id);
    const attemptMove = () =>
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: taken.slotId });
    const before = await stored(booking.id);
    await expect(attemptMove()).rejects.toMatchObject({ code: 'slot_unavailable' });
    expect(await stored(booking.id)).toEqual(before);
    expect(await sendDueReminders(deps())).toBe(2);
    const sent = await stored(booking.id);
    await expect(attemptMove()).rejects.toMatchObject({ code: 'slot_unavailable' });
    expect(await stored(booking.id)).toEqual(sent);
    expect(await sendDueReminders(deps())).toBe(0);
  });

  it('records failure without claiming delivery or retrying an uncertain send, and keeps the booking', async () => {
    const booking = await makeBooking();
    const before = await stored(booking.id);
    const failing: Mailer = {
      kind: 'smtp',
      send: async () => {
        throw new Error('SMTP unavailable');
      },
    };
    expect(await sendDueReminders(deps(failing))).toBe(0);
    expect(await stored(booking.id)).toEqual({ ...before, reminderAttemptedAt: clock.now() });
    expect(logs.events()).toContain('email.reminder.failed');
    expect(logs.events()).not.toContain('email.reminder.sent');
    expect(await sendDueReminders(deps())).toBe(0);
  });

  it('leaves eligibility intact when mail or reminders are disabled and keeps clinics separate', async () => {
    const other = await seedClinic(otherDatabase.db, clock, { settings: { clinicName: 'Other Dental Clinic' } });
    const booking = await makeBooking();
    expect(await sendDueReminders(deps(disabledMailer))).toBe(0);
    expect((await stored(booking.id)).reminderAttemptedAt).toBeNull();
    await setEnabled(false);
    expect((await loadClinicSettings(otherDatabase.db)).remindersEnabled).toBe(other.settings.remindersEnabled);
    expect(await sendDueReminders(deps())).toBe(0);
    expect((await stored(booking.id)).reminderAttemptedAt).toBeNull();
    await setEnabled(true);
    expect(await sendDueReminders(deps())).toBe(1);
  });

  it.each([false, true])(
    'keeps an SMTP attempt after reminders are switched off and on (uncertain: %s)',
    async (uncertain) => {
      const booking = await makeBooking();
      const send = vi.fn(async () => {
        if (uncertain) throw new Error('SMTP reply lost');
        return { messageId: 'fictional-reminder.test' };
      });
      const transport: Mailer = { kind: 'smtp', send };
      expect(await sendDueReminders(deps(transport))).toBe(uncertain ? 0 : 1);
      const attempted = await stored(booking.id);
      expect(attempted.reminderAttemptedAt).toEqual(clock.now());
      expect(attempted.reminderSentAt).toEqual(uncertain ? null : clock.now());
      await setEnabled(false);
      expect(await sendDueReminders(deps(transport))).toBe(0);
      clock.advanceMinutes(10);
      await setEnabled(true);
      expect(await sendDueReminders(deps(transport))).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await stored(booking.id)).toEqual(attempted);
    },
  );

  it('releases an unsent claim when staff disable reminders between claim and delivery', async () => {
    const booking = await makeBooking();
    const before = await stored(booking.id);
    mailer.sent.length = 0;
    const transaction = database.db.transaction.bind(database.db);
    const intercept = vi.spyOn(database.db, 'transaction').mockImplementationOnce(async (callback, config) => {
      const result = await transaction(callback, config);
      // The claim is committed, but the delivery transaction has not started.
      expect((await stored(booking.id)).reminderAttemptedAt).toEqual(clock.now());
      await setEnabled(false);
      return result;
    });
    try {
      expect(await sendDueReminders(deps())).toBe(0);
      expect(mailer.sent).toHaveLength(0);
      expect(await stored(booking.id)).toEqual(before);
    } finally {
      intercept.mockRestore();
    }
    clock.advanceMinutes(10);
    await setEnabled(true);
    expect(await sendDueReminders(deps())).toBe(1);
    expect(await sendDueReminders(deps())).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect((await stored(booking.id)).reminderSentAt).toEqual(clock.now());
  });

  it('does not release a moved revision claim when an older claim finds reminders disabled', async () => {
    const booking = await makeBooking();
    const target = await makeBooking(23.5, clinic.patient2.id);
    await cancelBooking(deps(), { patientId: clinic.patient2.id, bookingId: target.id });
    const transaction = database.db.transaction.bind(database.db);
    const intercept = vi.spyOn(database.db, 'transaction').mockImplementationOnce(async (callback, config) => {
      const result = await transaction(callback, config);
      await rescheduleBooking(deps(), {
        patientId: clinic.patient1.id,
        bookingId: booking.id,
        newSlotId: target.slotId,
      });
      const failing: Mailer = {
        kind: 'smtp',
        send: async () => {
          throw new Error('SMTP reply lost');
        },
      };
      expect(await sendDueReminders(deps(failing))).toBe(0);
      await setEnabled(false);
      return result;
    });
    try {
      expect(await sendDueReminders(deps())).toBe(0);
    } finally {
      intercept.mockRestore();
    }
    const moved = await stored(booking.id);
    expect(moved.rescheduleCount).toBe(1);
    expect(moved.reminderAttemptedAt).toEqual(clock.now());
    expect(moved.reminderSentAt).toBeNull();
    await setEnabled(true);
    expect(await sendDueReminders(deps())).toBe(0);
    expect(await stored(booking.id)).toEqual(moved);
  });

  it('asks for a fresh review if a cancellation becomes late before confirmation', async () => {
    const booking = await makeBooking(24);
    clock.advanceMinutes(1);
    await expect(
      cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, expectedLate: false }),
    ).rejects.toMatchObject({ code: 'booking_changed' });
    expect((await stored(booking.id)).status).toBe('confirmed');
    const cancelled = await cancelBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      expectedLate: true,
    });
    expect(cancelled.booking).toMatchObject({ status: 'cancelled', lateCancellation: true });
  });

  it('rejects stale review confirmations without moving or cancelling the current booking', async () => {
    const booking = await makeBooking(24);
    const target = await makeBooking(23.5, clinic.patient2.id);
    await cancelBooking(deps(), { patientId: clinic.patient2.id, bookingId: target.id });
    await rescheduleBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target.slotId,
      expectedRevision: 0,
    });
    const before = await stored(booking.id);
    await expect(
      cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: 'booking_changed' });
    await expect(
      rescheduleBooking(deps(), {
        patientId: clinic.patient1.id,
        bookingId: booking.id,
        newSlotId: booking.slotId,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'booking_changed' });
    expect(await stored(booking.id)).toEqual(before);
  });
});
