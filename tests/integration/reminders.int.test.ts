import { performance } from 'node:perf_hooks';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, clinicSettings } from '@/db/schema';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, disabledMailer } from '@/server/notifications/mailer';
import { REMINDER_LEAD_MS, sendDueReminders, type ReminderDependencies } from '@/server/notifications/reminder';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail, type RecordingMailer } from '../helpers/mail';
import { startStalledSmtp } from '../helpers/stalled-smtp';

let database: TestDatabase;
let clinic: SeededClinic;
let mailer: RecordingMailer;
let deps: ReminderDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');

beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  mailer = recordingMailer();
  deps = {
    db: database.db,
    clock,
    log: captureLogs(clock).log,
    mail: testMail(mailer),
    publicUrl: new URL('https://clinic.test'),
  };
});

async function makeBooking(index = 0) {
  const available = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T00:00:00Z'),
    until: new Date('2026-10-23T00:00:00Z'),
  });
  return bookSlot(deps, { patientId: clinic.patient1.id, slotId: available[index]!.id });
}
const reminders = () => mailer.sent.filter((mail) => mail.subject.startsWith('Appointment reminder:'));

describe('day-before appointment reminders', () => {
  it.each(['cancel', 'reschedule'] as const)(
    'allows clients to %s and staff to switch reminders off promptly after stalled delivery',
    async (change) => {
      const booking = await makeBooking();
      clock.set(new Date(booking.startsAt.getTime() - REMINDER_LEAD_MS));
      const smtp = await startStalledSmtp('delivery');
      const stalledDeps = { ...deps, mail: testMail(createSmtpMailer(smtp.url)) };
      const delivery = sendDueReminders(stalledDeps);
      try {
        await smtp.stalled;
        const started = performance.now();
        // These operations must contend with the actual delivery transaction,
        // rather than starting only after its locks have already been released.
        const updateSettings = database.db
          .update(clinicSettings)
          .set({ remindersEnabled: false })
          .where(eq(clinicSettings.id, 1));
        const changeBooking =
          change === 'cancel'
            ? cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id })
            : rescheduleBooking(deps, {
                patientId: clinic.patient1.id,
                bookingId: booking.id,
                newSlotId: (
                  await listAvailableSlots(database.db, {
                    practitionerId: clinic.practitioners.weekdays,
                    after: new Date('2026-10-23T00:00:00Z'),
                    until: new Date('2026-10-24T00:00:00Z'),
                  })
                )[0]!.id,
              });
        await Promise.all([delivery, updateSettings, changeBooking, smtp.disconnected]);
        expect(performance.now() - started).toBeLessThan(5_000);
        const [stored] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
        expect(stored!.reminderAttemptedAt).not.toBeNull();
        if (change === 'cancel') expect(stored!.status).toBe('cancelled');
        else expect(stored!.slotId).not.toBe(booking.slotId);
        const [settings] = await database.db.select().from(clinicSettings);
        expect(settings!.remindersEnabled).toBe(false);
        // Even after enabling reminders and entering the new slot's window,
        // an uncertain SMTP delivery must retain its committed claim.
        await database.db.update(clinicSettings).set({ remindersEnabled: true });
        clock.advanceMinutes(24 * 60);
        await sendDueReminders(stalledDeps);
        expect(smtp.connections).toBe(1);
      } finally {
        await smtp.stop();
        await delivery;
      }
    },
    8_000,
  );

  it('sends at the 24-hour boundary once, even with simultaneous checks and later checks', async () => {
    const booking = await makeBooking();
    clock.set(new Date(booking.startsAt.getTime() - REMINDER_LEAD_MS - 1));
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    clock.set(new Date(booking.startsAt.getTime() - REMINDER_LEAD_MS));
    await Promise.all([sendDueReminders(deps), sendDueReminders(deps)]);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]!.text).toContain(booking.practitionerName);
    clock.advanceMinutes(60);
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
    const [stored] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(stored!.reminderAttemptedAt).not.toBeNull();
  });

  it('does not remind cancelled or past bookings', async () => {
    const cancelled = await makeBooking();
    const past = await makeBooking(1);
    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: cancelled.id });
    clock.set(new Date(cancelled.startsAt.getTime() - REMINDER_LEAD_MS));
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    clock.set(past.startsAt);
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
  });

  it('uses the new appointment time after a move and never sends twice for that booking', async () => {
    const booking = await makeBooking();
    const available = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.weekdays,
      after: new Date('2026-10-23T00:00:00Z'),
      until: new Date('2026-10-24T00:00:00Z'),
    });
    const moved = await rescheduleBooking(deps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: available[0]!.id,
    });
    clock.set(new Date(booking.startsAt.getTime() - REMINDER_LEAD_MS));
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    clock.set(new Date(moved.startsAt.getTime() - REMINDER_LEAD_MS));
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
    // A move after the reminder has gone out still keeps the one-reminder limit.
    await rescheduleBooking(deps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: available[1]!.id,
    });
    clock.advanceMinutes(45);
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
  });

  it('respects the clinic switch and catches up future appointments when enabled', async () => {
    const booking = await makeBooking();
    clock.set(new Date(booking.startsAt.getTime() - REMINDER_LEAD_MS));
    await database.db.update(clinicSettings).set({ remindersEnabled: false });
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    await database.db.update(clinicSettings).set({ remindersEnabled: true });
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
  });

  it('does not consume reminders without SMTP and does not retry an uncertain delivery', async () => {
    const booking = await makeBooking();
    clock.set(new Date(booking.startsAt.getTime() - REMINDER_LEAD_MS));
    await sendDueReminders({ ...deps, mail: testMail(disabledMailer) });
    let attempts = 0;
    const failing = {
      ...deps,
      mail: testMail({
        kind: 'recording',
        send: async () => {
          attempts++;
          throw new Error('SMTP disconnected');
        },
      }),
    };
    await sendDueReminders(failing);
    await sendDueReminders(failing);
    expect(attempts).toBe(1);
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
  });
});
