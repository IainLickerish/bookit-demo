import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { bookingReturnPath } from '@/lib/routes';
import { addDays, addHours } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { disabledMailer } from '@/server/notifications/mailer';
import { sendDueReminders } from '@/server/notifications/reminders';
import { saveClinicSettings } from '@/server/settings';
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

function checkReminders() {
  return sendDueReminders({ ...bookingDeps(), mail: testMail(mailer), publicUrl });
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
  clock.set(addHours(cancelled.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);

  clock.set(addHours(moved.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]!.text).toContain('Tue, 27 Oct 2026, 09:00 (UK time)');
});

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

it('observes the clinic setting and does not remind a client once a session starts', async () => {
  const past = await bookAt(firstStart);
  const upcoming = await bookAt(nextStart, clinic.patient2.id);
  await saveClinicSettings(database.db, clock, { ...clinic.settings, reminderEmailsEnabled: false });
  clock.set(addHours(upcoming.startsAt, -24));
  await checkReminders();
  expect(mailer.sent).toHaveLength(0);

  clock.set(past.startsAt);
  await saveClinicSettings(database.db, clock, { ...clinic.settings, reminderEmailsEnabled: true });
  await checkReminders();
  expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient2.email]);
});

it('does not retry when the mail server may already have accepted a reminder', async () => {
  const booking = await bookAt(firstStart);
  clock.set(addHours(booking.startsAt, -24));
  const acceptingMailer = mailer;
  mailer = {
    ...acceptingMailer,
    send: async (email) => {
      await acceptingMailer.send(email);
      throw new Error('Connection lost after accepting the message');
    },
  };
  await checkReminders();
  expect(logs.events()).toContain('email.reminder.failed');
  mailer = acceptingMailer;
  await checkReminders();
  expect(mailer.sent).toHaveLength(1);
});
