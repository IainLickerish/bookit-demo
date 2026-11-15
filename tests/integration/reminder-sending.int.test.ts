import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingReminders, bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { sendDueReminders, type ReminderDependencies } from '@/server/reminders/send';
import { disabledMailer, type Mailer, type OutgoingEmail } from '@/server/notifications/mailer';
import { createSmtpMailer } from '@/server/notifications/mailer';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { recordingMailer, testMail, startSmtpReceiver } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
let logs: CapturedLogs;
let deps: ReminderDependencies;
let bookingDeps: BookingDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');
let sent: OutgoingEmail[];

beforeAll(async () => {
  database = await startTestDatabase(10);
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, {
    settings: { remindersEnabled: true, lateCancellationHours: 0, slotHorizonDays: 5 },
  });
  logs = captureLogs(clock);
  const mailer = recordingMailer();
  sent = mailer.sent;
  deps = {
    db: database.db,
    clock,
    log: logs.log,
    mail: testMail(mailer),
    tenant: 'acme',
    publicUrl: new URL('https://clinic.example.test'),
  };
  bookingDeps = { ...deps, mail: testMail() };
});

async function slotAt(start: string) {
  const [slot] = await database.db
    .select()
    .from(slots)
    .where(and(eq(slots.practitionerId, clinic.practitioners.weekdays), eq(slots.startsAt, new Date(start))));
  if (!slot) throw new Error(`Missing fictional slot ${start}`);
  return slot;
}
async function book(start = '2026-10-21T08:00:00Z') {
  return bookSlot(bookingDeps, { patientId: clinic.patient1.id, slotId: (await slotAt(start)).id });
}

describe('durable reminder sending', () => {
  it('waits until 24 hours before the current start and sends once through overlapping checks and restart', async () => {
    const booking = await book();
    expect(await sendDueReminders(deps)).toBe(0);
    expect(sent).toEqual([]);
    clock.set('2026-10-20T08:00:00Z');
    const results = await Promise.all([sendDueReminders(deps), sendDueReminders(deps)]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(`Booking reference: ${booking.id}`);
    const [history] = await database.db.select().from(bookingReminders);
    expect(history).toMatchObject({
      bookingId: booking.id,
      slotId: booking.slotId,
      startsAt: booking.startsAt,
      sentAt: clock.now(),
    });
    // A fresh connection and processor represent another process after a restart.
    const { createDatabase } = await import('@/db/client');
    const fresh = createDatabase(database.url, { max: 1 });
    const connection = await fresh.pool.connect();
    const closed = new Promise<void>((resolve) => connection.once('end', () => resolve()));
    connection.release();
    try {
      expect(await sendDueReminders({ ...deps, db: fresh.db })).toBe(0);
    } finally {
      await fresh.pool.end();
      await closed;
    }
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(logs.lines)).not.toMatch(/Patient One|patients\.example\.test|7700/);
  });
  it('reaches every due booking in one check beyond refused addresses and former patients', async () => {
    const at = clock.now();
    const id = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    // 50 refused recipients, then 50 former patients, then 60 eligible bookings.
    // Equal start times exercise the booking-reference part of the page cursor.
    const patientRows = Array.from({ length: 160 }, (_, index) => ({
      id: id(1000 + index),
      email: index < 50 ? `refused-${index}` : `pagination-${index}@patients.example.test`,
      name: `Fictional Pagination Client ${index}`,
      role: index >= 50 && index < 100 ? ('admin' as const) : ('patient' as const),
      passwordHash: 'unused-fictional-hash',
      createdAt: at,
      updatedAt: at,
    }));
    const practitionerRows = patientRows.map((_, index) => ({
      id: id(2000 + index),
      name: `Pagination Practitioner ${index}`,
      bio: 'Fictional fixture',
      workingDays: [1, 2, 3, 4, 5],
      workdayStart: '09:00',
      workdayEnd: '17:00',
      active: true,
      createdAt: at,
      updatedAt: at,
    }));
    await database.db.insert(users).values(patientRows);
    await database.db.insert(practitioners).values(practitionerRows);
    await database.db.insert(slots).values(
      patientRows.map((_, index) => ({
        id: id(3000 + index),
        practitionerId: id(2000 + index),
        startsAt: new Date('2026-10-20T08:00:00Z'),
        endsAt: new Date('2026-10-20T08:45:00Z'),
        createdAt: at,
      })),
    );
    await database.db.insert(bookings).values(
      patientRows.map((_, index) => ({
        id: id(4000 + index),
        patientId: id(1000 + index),
        slotId: id(3000 + index),
        status: 'confirmed' as const,
        lateCancellation: false,
        rescheduleCount: 0,
        createdAt: at,
        updatedAt: at,
      })),
    );
    expect(await sendDueReminders(deps)).toBe(60);
    expect(sent).toHaveLength(60);
    expect(new Set(sent.map((email) => email.to))).toEqual(
      new Set(patientRows.slice(100).map((patient) => patient.email)),
    );
    const history = await database.db.select().from(bookingReminders);
    expect(history).toHaveLength(60);
    expect(new Set(history.map((row) => row.bookingId))).toEqual(
      new Set(Array.from({ length: 60 }, (_, index) => id(4100 + index))),
    );
    expect(await sendDueReminders(deps)).toBe(0);
    expect(sent).toHaveLength(60);
  });
  it('uses the moved time, current practitioner and current clinic details', async () => {
    const booking = await book();
    const target = await slotAt('2026-10-22T08:00:00Z');
    await rescheduleBooking(bookingDeps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target.id,
    });
    clock.set('2026-10-20T08:00:00Z');
    expect(await sendDueReminders(deps)).toBe(0);
    await database.db
      .update(practitioners)
      .set({ name: 'Current Practitioner' })
      .where(eq(practitioners.id, target.practitionerId));
    await database.db.update(clinicSettings).set({ clinicName: 'Current Clinic', timeZone: 'Europe/Paris' });
    clock.set('2026-10-21T08:00:00Z');
    expect(await sendDueReminders(deps)).toBe(1);
    expect(sent[0]?.text).toContain('Thu, 22 Oct 2026, 09:00 (UK time)');
    expect(sent[0]?.text).toContain('Physiotherapist: Current Practitioner');
    expect(sent[0]?.text.startsWith('Current Clinic\n')).toBe(true);
    expect(sent[0]?.text).not.toContain('Wed, 21 Oct');
  });
  it('skips disabled reminders, cancelled bookings, started bookings and a disabled mail service without reservations', async () => {
    const booking = await book('2026-10-20T08:00:00Z');
    await database.db.update(clinicSettings).set({ remindersEnabled: false });
    expect(await sendDueReminders(deps)).toBe(0);
    await database.db.update(clinicSettings).set({ remindersEnabled: true });
    expect(await sendDueReminders({ ...deps, mail: testMail(disabledMailer) })).toBe(0);
    await cancelBooking(bookingDeps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect((await database.db.select().from(bookings))[0]?.status).toBe('cancelled');
    expect(await sendDueReminders(deps)).toBe(0);
    const started = await book('2026-10-20T09:30:00Z');
    clock.set(started.startsAt);
    expect(await sendDueReminders(deps)).toBe(0);
    expect(sent).toEqual([]);
    expect(await database.db.select().from(bookingReminders)).toEqual([]);
  });
  it('does not retry a mail result that may already have been accepted, even after a move', async () => {
    const booking = await book('2026-10-20T08:00:00Z');
    let attempts = 0;
    const uncertain: Mailer = {
      kind: 'smtp',
      send: async (email) => {
        attempts++;
        sent.push(email);
        throw new Error('synthetic acknowledgement lost');
      },
    };
    expect(await sendDueReminders({ ...deps, mail: testMail(uncertain) })).toBe(0);
    expect((await database.db.select().from(bookingReminders))[0]?.sentAt).toBeNull();
    const target = await slotAt('2026-10-20T09:30:00Z');
    await rescheduleBooking(bookingDeps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target.id,
    });
    expect(await sendDueReminders({ ...deps, mail: testMail(uncertain) })).toBe(0);
    expect(await sendDueReminders(deps)).toBe(0);
    expect(attempts).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it('does not repeat an accepted email when recording its outcome fails', async () => {
    await book('2026-10-20T08:00:00Z');
    const transaction = database.db.transaction.bind(database.db);
    let transactions = 0;
    const spy = vi.spyOn(database.db, 'transaction').mockImplementation(async (body, options) => {
      transactions++;
      return transaction(async (tx) => {
        const result = await body(tx);
        if (transactions === 2) throw new Error('synthetic result commit failure');
        return result;
      }, options);
    });
    try {
      expect(await sendDueReminders(deps)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(sent).toHaveLength(1);
    expect((await database.db.select().from(bookingReminders))[0]?.sentAt).toBeNull();
    expect(await sendDueReminders(deps)).toBe(0);
    expect(sent).toHaveLength(1);
  });
  it('retains a reservation if the process stops before sending, without fabricating delivery', async () => {
    const booking = await book('2026-10-20T08:00:00Z');
    await database.db
      .insert(bookingReminders)
      .values({ bookingId: booking.id, slotId: booking.slotId, startsAt: booking.startsAt, reservedAt: clock.now() });
    expect(await sendDueReminders(deps)).toBe(0);
    expect(sent).toEqual([]);
    expect((await database.db.select().from(bookingReminders))[0]?.sentAt).toBeNull();
  });
  it('rechecks a move between reservation and sending and releases only that fresh unused reservation', async () => {
    const booking = await book('2026-10-20T08:00:00Z');
    const target = await slotAt('2026-10-22T08:00:00Z');
    const transaction = database.db.transaction.bind(database.db);
    let transactions = 0;
    const spy = vi.spyOn(database.db, 'transaction').mockImplementation(async (body, options) => {
      transactions++;
      if (transactions === 2) {
        await database.db
          .update(bookings)
          .set({ slotId: target.id, rescheduleCount: 1 })
          .where(eq(bookings.id, booking.id));
      }
      return transaction(body, options);
    });
    try {
      expect(await sendDueReminders(deps)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(sent).toEqual([]);
    expect(await database.db.select().from(bookingReminders)).toEqual([]);
    clock.set('2026-10-21T08:00:00Z');
    expect(await sendDueReminders(deps)).toBe(1);
    expect(sent[0]?.text).toContain('Thu, 22 Oct 2026, 09:00');
  });
  it.each(['cancellation', 'switching reminders off'] as const)(
    'rechecks %s after committing the reservation',
    async (change) => {
      const booking = await book('2026-10-20T08:00:00Z');
      const transaction = database.db.transaction.bind(database.db);
      let transactions = 0;
      const spy = vi.spyOn(database.db, 'transaction').mockImplementation(async (body, options) => {
        transactions++;
        if (transactions === 2) {
          if (change === 'cancellation') {
            await database.db
              .update(bookings)
              .set({ status: 'cancelled', cancelledAt: clock.now(), updatedAt: clock.now() })
              .where(eq(bookings.id, booking.id));
          } else {
            await database.db.update(clinicSettings).set({ remindersEnabled: false });
          }
        }
        return transaction(body, options);
      });
      try {
        expect(await sendDueReminders(deps)).toBe(0);
      } finally {
        spy.mockRestore();
      }
      expect(sent).toEqual([]);
      expect(await database.db.select().from(bookingReminders)).toEqual([]);
    },
  );
  it('serialises a cancellation against in-flight SMTP, preserving a truthful send snapshot', async () => {
    const booking = await book('2026-10-20T08:00:00Z');
    let release!: () => void;
    let entered!: () => void;
    const enteredSmtp = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer: Mailer = {
      kind: 'recording',
      send: async (email) => {
        entered();
        await waiting;
        sent.push(email);
        return { messageId: '<locked@test>' };
      },
    };
    const sending = sendDueReminders({ ...deps, mail: testMail(mailer) });
    await enteredSmtp;
    const cancellation = cancelBooking(bookingDeps, { patientId: clinic.patient1.id, bookingId: booking.id });
    release();
    expect(await sending).toBe(1);
    expect((await cancellation).booking.status).toBe('cancelled');
    expect(sent).toHaveLength(1);
    expect((await database.db.select().from(bookingReminders))[0]?.slotId).toBe(booking.slotId);
  });
  it('refuses non-demo recipients without storing a reservation or leaking their address', async () => {
    await book('2026-10-20T08:00:00Z');
    await database.db.update(users).set({ email: 'not-an-email' }).where(eq(users.id, clinic.patient1.id));
    expect(await sendDueReminders(deps)).toBe(0);
    expect(sent).toEqual([]);
    expect(await database.db.select().from(bookingReminders)).toEqual([]);
    expect(JSON.stringify(logs.lines)).not.toContain('not-an-email');
  });
  it('uses the supplied clinic database only', async () => {
    const other = await startTestDatabase();
    try {
      await seedClinic(other.db, clock, {
        settings: { clinicName: 'Other Fictional Clinic', remindersEnabled: true, slotHorizonDays: 2 },
      });
      await book('2026-10-20T08:00:00Z');
      expect(await sendDueReminders({ ...deps, db: other.db, tenant: 'beacon' })).toBe(0);
      expect(await database.db.select().from(bookingReminders)).toEqual([]);
      expect(await sendDueReminders(deps)).toBe(1);
      expect(await other.db.select().from(bookingReminders)).toEqual([]);
    } finally {
      await other.stop();
    }
  });
  it('delivers through the existing local SMTP mail service', async () => {
    await book('2026-10-20T08:00:00Z');
    const smtp = await startSmtpReceiver();
    try {
      const mail = { from: deps.mail.from, mailer: createSmtpMailer(smtp.url) };
      expect(await sendDueReminders({ ...deps, mail })).toBe(1);
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]?.to).toEqual([clinic.patient1.email]);
      expect(await sendDueReminders({ ...deps, mail })).toBe(0);
    } finally {
      await smtp.stop();
    }
  });
});
