import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addHours, addMinutes } from '@/lib/time';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
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
    const { clinicName, timeZone, lateCancellationHours, includeContactInConfirmation } = clinic.settings;
    const editable = { clinicName, timeZone, lateCancellationHours, includeContactInConfirmation };
    const mailer = recordingMailer();
    clock.set(addHours(booking.startsAt, -24));

    await updateAdminSettings(database.db, clock, { ...editable, sendBookingReminders: false });
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(0);

    await updateAdminSettings(database.db, clock, { ...editable, sendBookingReminders: true });
    await sendDueBookingReminders(deps(mailer));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(clinic.patient1.email);
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
