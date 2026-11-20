import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { slots } from '@/db/schema';
import { updateAdminSettings } from '@/server/admin/settings';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer, disabledMailer } from '@/server/notifications/mailer';
import { sendDueReminders } from '@/server/notifications/reminders';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, startSmtpReceiver, testMail, type SmtpReceiver } from '../helpers/mail';

const BASE_URL = new URL('https://clinic.example.test');
const INITIAL_TIME = '2026-10-20T07:00:00Z';
const FIRST_START = '2026-10-22T08:00:00Z';
const FIRST_DUE = '2026-10-21T08:00:00Z';
const clock = manualClock(INITIAL_TIME);
let database: TestDatabase;
let smtp: SmtpReceiver;
let clinic: SeededClinic;

function dependencies(mail = testMail()) {
  return { db: database.db, clock, log: captureLogs(clock).log, mail };
}

async function slotAt(start: string): Promise<string> {
  const [slot] = await database.db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.practitionerId, clinic.practitioners.weekdays), eq(slots.startsAt, new Date(start))));
  if (!slot) throw new Error(`No test slot at ${start}`);
  return slot.id;
}

async function book(start: string, patientId = clinic.patient1.id) {
  return bookSlot(dependencies(), { patientId, slotId: await slotAt(start) });
}

beforeAll(async () => {
  database = await startTestDatabase(5);
  smtp = await startSmtpReceiver();
});

beforeEach(async () => {
  clock.set(INITIAL_TIME);
  await emptyDatabase(database.db);
  smtp.messages.length = 0;
  clinic = await seedClinic(database.db, clock);
});

afterAll(async () => {
  await smtp?.stop();
  await database?.stop();
});

describe('session reminders', () => {
  it('sends one reminder at 24 hours even when checks run concurrently and repeat', async () => {
    await book(FIRST_START);
    const deps = dependencies(testMail(createSmtpMailer(smtp.url)));

    clock.set('2026-10-21T07:59:59Z');
    await sendDueReminders(deps, BASE_URL);
    expect(smtp.messages).toHaveLength(0);

    clock.set(FIRST_DUE);
    await Promise.all([sendDueReminders(deps, BASE_URL), sendDueReminders(deps, BASE_URL)]);
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]?.to).toEqual([clinic.patient1.email]);

    clock.advanceMinutes(1);
    await sendDueReminders(deps, BASE_URL);
    expect(smtp.messages).toHaveLength(1);
  });

  it('shows the clinic date and time, physiotherapist and private booking links', async () => {
    const booking = await book(FIRST_START);
    const mailer = recordingMailer();
    clock.set(FIRST_DUE);

    await sendDueReminders(dependencies(testMail(mailer)), BASE_URL);

    expect(mailer.sent).toHaveLength(1);
    const [email] = mailer.sent;
    expect(email?.text).toMatch(/^Test Physio Clinic\n/);
    expect(email?.text).toContain('Thu, 22 Oct 2026, 09:00 (Europe/London)');
    expect(email?.text).toContain('Physiotherapist: Pat Physio');
    expect(email?.text).toContain(
      `Reschedule your session: https://clinic.example.test/bookings/${booking.id}/reschedule\n`,
    );
    expect(email?.text).toContain(`Cancel your session: https://clinic.example.test/bookings?cancel=${booking.id}\n`);
  });

  it('skips cancelled sessions and uses the new time for a moved session', async () => {
    const moved = await book(FIRST_START);
    const cancelled = await book('2026-10-22T08:45:00Z', clinic.patient2.id);
    const mailer = recordingMailer();
    const deps = dependencies(testMail(mailer));
    await cancelBooking(deps, { patientId: cancelled.patientId, bookingId: cancelled.id });
    await rescheduleBooking(deps, {
      patientId: moved.patientId,
      bookingId: moved.id,
      newSlotId: await slotAt('2026-10-23T09:30:00Z'),
    });

    clock.set('2026-10-21T08:45:00Z');
    await sendDueReminders(deps, BASE_URL);
    expect(mailer.sent).toHaveLength(0);

    clock.set('2026-10-22T09:30:00Z');
    await sendDueReminders(deps, BASE_URL);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: clinic.patient1.email,
      text: expect.stringContaining('Fri, 23 Oct 2026, 10:30 (Europe/London)'),
    });

    await rescheduleBooking(deps, {
      patientId: moved.patientId,
      bookingId: moved.id,
      newSlotId: await slotAt('2026-10-26T09:00:00Z'),
    });
    clock.set('2026-10-25T09:00:00Z');
    await sendDueReminders(deps, BASE_URL);
    expect(mailer.sent).toHaveLength(1);
  });

  it('follows the saved clinic reminder switch when it is turned off and on', async () => {
    await book(FIRST_START);
    const mailer = recordingMailer();
    const deps = dependencies(testMail(mailer));
    const { clinicName, timeZone, lateCancellationHours, includeContactInConfirmation } = clinic.settings;
    const editable = { clinicName, timeZone, lateCancellationHours, includeContactInConfirmation };

    await updateAdminSettings(database.db, clock, { ...editable, reminderEmailsEnabled: false });
    clock.set(FIRST_DUE);
    await sendDueReminders(deps, BASE_URL);
    expect(mailer.sent).toHaveLength(0);

    await updateAdminSettings(database.db, clock, { ...editable, reminderEmailsEnabled: true });
    await sendDueReminders(deps, BASE_URL);
    expect(mailer.sent).toHaveLength(1);
  });

  it('picks up short-notice bookings and skips sessions that have already started', async () => {
    await book(FIRST_START);
    clock.set(FIRST_START);
    await book('2026-10-22T08:45:00Z', clinic.patient2.id);
    const mailer = recordingMailer();

    await sendDueReminders(dependencies(testMail(disabledMailer)), BASE_URL);
    await sendDueReminders(dependencies(testMail(mailer)), BASE_URL);

    expect(mailer.sent.map((email) => email.to)).toEqual([clinic.patient2.email]);
  });

  it('does not retry an email when delivery may already have succeeded', async () => {
    await book(FIRST_START);
    const mailer = recordingMailer();
    const { log, events } = captureLogs(clock);
    const deps = { ...dependencies(testMail(mailer)), log };
    clock.set(FIRST_DUE);
    await sendDueReminders(
      {
        ...deps,
        mail: testMail({
          kind: 'recording',
          async send(email) {
            await mailer.send(email);
            throw new Error('SMTP acknowledgement lost');
          },
        }),
      },
      BASE_URL,
    );
    await sendDueReminders(deps, BASE_URL);

    expect(mailer.sent).toHaveLength(1);
    expect(events()).toEqual(['email.reminder.failed']);
  });
});
