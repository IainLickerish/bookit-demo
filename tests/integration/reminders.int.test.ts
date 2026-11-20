import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { addHours } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import * as errorReporting from '@/server/error-reporting';
import { sendDueReminders } from '@/server/notifications/reminders';
import { saveClinicSettings } from '@/server/settings';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { recordingMailer, testMail, type RecordingMailer } from '../helpers/mail';

const start = '2026-10-20T07:00:00Z';
const clock = manualClock(start);
let database: TestDatabase;
let clinic: SeededClinic;
let mailer: RecordingMailer;
let logs: CapturedLogs;

function deps() {
  return {
    db: database.db,
    clock,
    log: logs.log,
    mail: testMail(mailer),
    publicUrl: new URL('https://bookit.example.test'),
  };
}

async function slotAt(instant: string): Promise<string> {
  const available = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: addHours(clock.now(), 7 * 24),
  });
  const slot = available.find((slot) => slot.startsAt.toISOString() === instant);
  if (!slot) throw new Error(`No available test slot at ${instant}`);
  return slot.id;
}

async function bookAt(instant: string, patientId = clinic.patient1.id) {
  const booking = await bookSlot(deps(), { patientId, slotId: await slotAt(instant) });
  mailer.sent.length = 0;
  return booking;
}

async function setReminders(remindersEnabled: boolean) {
  await saveClinicSettings(database.db, clock, { ...clinic.settings, remindersEnabled });
}

beforeAll(async () => {
  database = await startTestDatabase(5);
});

afterAll(async () => {
  await database?.stop();
});

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  clock.set(start);
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { remindersEnabled: true } });
  mailer = recordingMailer();
  logs = captureLogs(clock);
});

it('sends one reminder at 24 hours even when reminder checks overlap or repeat', async () => {
  await bookAt('2026-10-22T08:00:00.000Z');

  clock.set('2026-10-21T07:59:59.999Z');
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(0);

  clock.set('2026-10-21T08:00:00Z');
  await Promise.all([sendDueReminders(deps()), sendDueReminders(deps())]);
  clock.advanceMinutes(30);
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]?.to).toBe(clinic.patient1.email);
});

it('emails the UK session time, physiotherapist and signed-in booking links to the client', async () => {
  const booking = await bookAt('2026-10-22T08:00:00.000Z', clinic.patient2.id);
  clock.set('2026-10-21T08:00:00Z');
  await sendDueReminders(deps());

  expect(mailer.sent).toHaveLength(1);
  const [message] = mailer.sent;
  expect(message).toMatchObject({ to: clinic.patient2.email, subject: 'Your session reminder' });
  expect(message!.text).toMatch(/^Test Physio Clinic\n/);
  expect(message!.text).toContain('Thu, 22 Oct 2026, 09:00 (UK time) with Pat Physio');
  const links = message!.text
    .split('\n')
    .filter((line) => line.startsWith('https://'))
    .map((line) => new URL(line));
  expect(links.map((link) => `${link.origin}${link.pathname}`)).toEqual([
    'https://bookit.example.test/auth/sign-in',
    'https://bookit.example.test/auth/sign-in',
  ]);
  expect(links.map((link) => link.searchParams.get('next'))).toEqual([
    `/bookings/${booking.id}/reschedule`,
    `/bookings#booking-${booking.id}`,
  ]);
  expect(message!.text).not.toContain(clinic.patient1.email);
});

it('skips cancelled sessions and sends a moved session’s reminder at its new time only', async () => {
  const cancelled = await bookAt('2026-10-22T08:00:00.000Z');
  const moved = await bookAt('2026-10-22T08:45:00.000Z', clinic.patient2.id);
  await cancelBooking(deps(), { bookingId: cancelled.id, patientId: cancelled.patientId });
  await rescheduleBooking(deps(), {
    bookingId: moved.id,
    patientId: moved.patientId,
    newSlotId: await slotAt('2026-10-23T08:45:00.000Z'),
  });

  clock.set('2026-10-21T08:45:00Z');
  await sendDueReminders(deps());
  clock.set('2026-10-22T08:44:59.999Z');
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(0);

  clock.set('2026-10-22T08:45:00Z');
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({
    to: clinic.patient2.email,
    text: expect.stringContaining('Fri, 23 Oct 2026, 09:45 (UK time)'),
  });

  await rescheduleBooking(deps(), {
    bookingId: moved.id,
    patientId: moved.patientId,
    newSlotId: await slotAt('2026-10-26T09:00:00.000Z'),
  });
  clock.set('2026-10-25T09:00:00Z');
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(1);
});

it('sends nothing while reminders are off and skips sessions that have already started when turned on', async () => {
  await bookAt('2026-10-22T08:00:00.000Z');
  await bookAt('2026-10-22T08:45:00.000Z', clinic.patient2.id);
  await setReminders(false);
  clock.set('2026-10-21T08:45:00Z');
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(0);

  clock.set('2026-10-22T08:00:00Z');
  await setReminders(true);
  await sendDueReminders(deps());
  expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient2.email]);
});

it('does not send twice or report a client address if SMTP disconnects after acceptance', async () => {
  await bookAt('2026-10-22T08:00:00.000Z');
  const report = vi.spyOn(errorReporting, 'reportError').mockImplementation(() => undefined);
  const accept = mailer.send;
  mailer.send = async (email) => {
    await accept(email);
    throw new Error(`Test disconnect after sending to ${email.to}`);
  };
  clock.set('2026-10-21T08:00:00Z');
  await sendDueReminders(deps());
  await sendDueReminders(deps());
  expect(mailer.sent).toHaveLength(1);
  expect(logs.events().filter((event) => typeof event === 'string' && event.startsWith('email.reminder.'))).toEqual([
    'email.reminder.failed',
  ]);
  expect(JSON.stringify(logs.lines)).not.toContain(clinic.patient1.email);
  expect(report).toHaveBeenCalledWith(new Error('Session reminder could not be sent.'), {
    operation: 'reminder_email',
  });
});
