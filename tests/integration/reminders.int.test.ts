import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { bookingReminders, bookings, slots } from '@/db/schema';
import { newId } from '@/lib/ids';
import { addHours, addMinutes } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { cancelBooking } from '@/server/bookings/cancel';
import { disabledMailer } from '@/server/notifications/mailer';
import { sendDueReminders, type ReminderDependencies } from '@/server/notifications/reminders';
import { saveClinicSettings } from '@/server/settings';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { createUser } from '@/server/users';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, startSmtpReceiver, type SmtpReceiver } from '../helpers/mail';
import { buildServer, launchServer, TEST_COMMIT, writeClockFile, type RunningServer } from '../helpers/built-server';

let database: TestDatabase;
let foreign: TestDatabase;
let clinic: SeededClinic;
let smtp: SmtpReceiver;
const clock = manualClock('2026-10-20T07:00:00Z');
let mailer = recordingMailer();
let log = captureLogs(clock);
const publicUrl = new URL('https://acme.example.test');
const deps = (): ReminderDependencies => ({
  db: database.db,
  clock,
  log: log.log,
  mail: { mailer, from: 'noreply@acmephysio.test' },
  publicUrl,
  words: { booking: 'session', practitioner: 'physiotherapist' },
});

beforeAll(async () => {
  database = await startTestDatabase();
  foreign = await startTestDatabase();
  smtp = await startSmtpReceiver();
});
afterAll(async () => {
  await smtp?.stop();
  await Promise.allSettled([database?.stop(), foreign?.stop()]);
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  await emptyDatabase(foreign.db);
  clinic = await seedClinic(database.db, clock);
  mailer = recordingMailer();
  log = captureLogs(clock);
  smtp.messages.length = 0;
});

async function makeBooking(
  start = '2026-10-22T08:00:00Z',
  bookedAt = '2026-10-20T07:00:00Z',
  patientId = clinic.patient1.id,
) {
  const startsAt = new Date(start);
  const [existing] = await database.db
    .select()
    .from(slots)
    .where(and(eq(slots.practitionerId, clinic.practitioners.weekdays), eq(slots.startsAt, startsAt)));
  const slotId = existing?.id ?? newId(clock);
  if (!existing)
    await database.db.insert(slots).values({
      id: slotId,
      practitionerId: clinic.practitioners.weekdays,
      startsAt,
      endsAt: addMinutes(startsAt, 45),
      createdAt: clock.now(),
    });
  clock.set(bookedAt);
  return bookSlot(deps(), { patientId, slotId });
}

it('sends once at the 24-hour boundary despite repeated and concurrent runs', async () => {
  const booking = await makeBooking();
  const due = addHours(booking.startsAt, -24);
  const before = await database.db.select().from(bookings);
  mailer.sent.length = 0;
  clock.set(new Date(due.getTime() - 1));
  expect(await sendDueReminders(deps())).toBe(0);
  clock.set(due);
  const results = await Promise.all([sendDueReminders(deps()), sendDueReminders(deps())]);
  expect(results.reduce((total, count) => total + count, 0)).toBe(1);
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]!.to).toBe(clinic.patient1.email);
  expect(mailer.sent[0]!.text).toContain('Thu, 22 Oct 2026, 09:00 (Europe/London)');
  expect(mailer.sent[0]!.text).toContain(`/bookings#booking-${booking.id}`);
  clock.advanceMinutes(4);
  expect(await sendDueReminders(deps())).toBe(0);
  expect(await database.db.select().from(bookingReminders)).toHaveLength(1);
  expect(await database.db.select().from(bookings)).toEqual(before);
  expect(JSON.stringify(log.lines)).not.toContain(clinic.patient1.email);
});

it('excludes cancelled bookings and bookings made less than 24 hours ahead', async () => {
  const cancelled = await makeBooking();
  await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: cancelled.id });
  await makeBooking('2026-10-22T08:45:00Z', '2026-10-21T08:45:00.001Z', clinic.patient2.id);
  mailer.sent.length = 0;
  clock.set('2026-10-21T08:00:00Z');
  expect(await sendDueReminders(deps())).toBe(0);
  clock.set('2026-10-21T08:45:00Z');
  expect(await sendDueReminders(deps())).toBe(0);
  expect(mailer.sent).toHaveLength(0);
  expect(await database.db.select().from(bookingReminders)).toHaveLength(0);
});

it('includes a booking made exactly 24 hours ahead and never sends outside the five-minute window', async () => {
  await makeBooking('2026-10-22T08:00:00Z', '2026-10-21T08:00:00Z');
  mailer.sent.length = 0;
  expect(await sendDueReminders(deps())).toBe(1);
  const late = await makeBooking('2026-10-22T08:45:00Z');
  clock.set(addMinutes(addHours(late.startsAt, -24), 5 + 1 / 60_000));
  expect(await sendDueReminders(deps())).toBe(0);
  expect(mailer.sent.filter((email) => email.subject.startsWith('Your session reminder'))).toHaveLength(1);
});

it('honours the saved switch without affecting another clinic', async () => {
  await makeBooking();
  const other = await seedClinic(foreign.db, clock, {
    settings: { clinicName: 'Beacon Dental', remindersEnabled: false },
  });
  const patient = await createUser(foreign.db, clock, {
    name: 'Beacon Demo Client',
    email: 'demo@patients.beacondental.test',
    role: 'patient',
    password: TEST_PASSWORD,
  });
  const [slot] = await foreign.db
    .select()
    .from(slots)
    .where(
      and(eq(slots.practitionerId, other.practitioners.weekdays), eq(slots.startsAt, new Date('2026-10-22T08:00:00Z'))),
    );
  const otherDeps: ReminderDependencies = {
    ...deps(),
    db: foreign.db,
    publicUrl: new URL('https://beacon.example.test'),
    mail: { mailer, from: 'noreply@beacondental.test' },
    words: { booking: 'appointment', practitioner: 'clinician' },
  };
  await bookSlot(otherDeps, { patientId: patient.id, slotId: slot!.id });
  await saveClinicSettings(database.db, clock, { ...clinic.settings, remindersEnabled: false });
  clock.set('2026-10-21T08:00:00Z');
  expect(await sendDueReminders(deps())).toBe(0);
  expect(await database.db.select().from(bookingReminders)).toHaveLength(0);
  await saveClinicSettings(database.db, clock, { ...clinic.settings, remindersEnabled: true });
  expect(await sendDueReminders(deps())).toBe(1);
  expect(await sendDueReminders(otherDeps)).toBe(0);
  expect(await foreign.db.select().from(bookingReminders)).toHaveLength(0);
  expect(
    mailer.sent.filter((email) => email.subject.startsWith('Your session reminder')).map((email) => email.to),
  ).toEqual([clinic.patient1.email]);
  expect(other.settings.remindersEnabled).toBe(false);
  await saveClinicSettings(foreign.db, clock, { ...other.settings, remindersEnabled: true });
  expect(await sendDueReminders(otherDeps)).toBe(1);
  const reminder = mailer.sent.find((email) => email.subject.startsWith('Your appointment reminder:'))!;
  expect(reminder.to).toBe(patient.email);
  expect(reminder.text).toContain('Beacon Dental');
  expect(reminder.text).toContain('With your clinician:');
});

it.each([
  ['2026-10-25T09:00:00Z', '2026-10-24T09:00:00Z', 'Sun, 25 Oct 2026, 09:00'],
  ['2027-03-28T08:00:00Z', '2027-03-27T08:00:00Z', 'Sun, 28 Mar 2027, 09:00'],
])('uses 24 elapsed hours across the clock change for %s', async (start, due, display) => {
  await makeBooking(start);
  mailer.sent.length = 0;
  clock.set(due);
  expect(await sendDueReminders(deps())).toBe(1);
  expect(mailer.sent[0]!.text).toContain(display);
});

it('does not record a dispatch when email is disabled or before the claim can commit', async () => {
  await makeBooking();
  mailer.sent.length = 0;
  clock.set('2026-10-21T08:00:00Z');
  expect(await sendDueReminders({ ...deps(), mail: { ...deps().mail, mailer: disabledMailer } })).toBe(0);
  expect(await database.db.select().from(bookingReminders)).toHaveLength(0);
  const failure = vi.spyOn(database.db, 'transaction').mockRejectedValueOnce(new Error('Synthetic claim failure'));
  try {
    await expect(sendDueReminders(deps())).rejects.toThrow('Synthetic claim failure');
    expect(mailer.sent).toHaveLength(0);
  } finally {
    failure.mockRestore();
  }
});

it('starts automatic reminder delivery with the web server and uses the configured clinic sender', async () => {
  const booking = await makeBooking();
  const file = writeClockFile(addHours(booking.startsAt, -24).toISOString());
  const dist = '.next-reminders';
  const build = buildServer(dist, { allowTestClock: true, args: { GIT_COMMIT: TEST_COMMIT } });
  if (build.status !== 0) console.log(build.output);
  expect(build.status).toBe(0);
  let server: RunningServer | undefined;
  try {
    server = await launchServer(dist, {
      DATABASE_URL: database.url,
      BOOKIT_TENANT: 'acme',
      BOOKIT_PRODUCT: 'ACME',
      BOOKIT_ENV: 'local',
      BOOKIT_PUBLIC_URL: publicUrl.origin,
      BOOKIT_SMTP_URL: smtp.url,
      BOOKIT_MAIL_FROM: 'noreply@acmephysio.test',
      BOOKIT_TEST_CLOCK: file,
    });
    expect(server.served, server.output()).toBe(true);
    await expect
      .poll(() => smtp.messages.length, { timeout: 15_000 })
      .toBe(1)
      .catch((error: unknown) => {
        console.log(server!.output());
        throw error;
      });
    expect(smtp.messages[0]!.to).toEqual([clinic.patient1.email]);
    expect(smtp.messages[0]!.from).toBe('noreply@acmephysio.test');
    expect(smtp.messages[0]!.raw).toContain('Your session reminder:');
    expect(await database.db.select().from(bookingReminders)).toHaveLength(1);
    const session = await createSession(database.db, manualClock(addHours(booking.startsAt, -24)), clinic.admin.id);
    // Node fetch replaces a custom Host, so use HTTP directly to reproduce the ingress proxy.
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = httpRequest(
        `${server!.url}/api/debug/reminders`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `${SESSION_COOKIE}=${session.token}`,
            host: 'public-clinic.example.test',
            origin: 'http://public-clinic.example.test',
          },
        },
        (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => {
            body += chunk;
          });
          incoming.on('end', () => resolve({ status: incoming.statusCode!, body }));
        },
      );
      outgoing.on('error', reject);
      outgoing.setTimeout(10_000, () => outgoing.destroy(new Error('Test proxy request timed out')));
      outgoing.end(JSON.stringify({ bookingId: booking.id, now: addHours(booking.startsAt, -24).toISOString() }));
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processed: 0 });
    expect(smtp.messages).toHaveLength(1);
  } finally {
    await server?.stop();
  }
}, 300_000);
import { request as httpRequest } from 'node:http';
