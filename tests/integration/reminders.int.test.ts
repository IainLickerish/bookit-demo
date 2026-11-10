import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings } from '@/db/schema';
import { addHours, localDateOf } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { sendDueReminders } from '@/server/notifications/reminders';
import { saveClinicSettings } from '@/server/settings';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { recordingMailer, testMail, type RecordingMailer } from '../helpers/mail';

const START = '2026-10-20T07:00:00Z';
const PUBLIC_URL = new URL('https://clinic.example.test');

let database: TestDatabase;
let clinic: SeededClinic;
let logs: CapturedLogs;
let mailer: RecordingMailer;
const clock = manualClock(START);

async function freeSlot(localDate: string, index = 0): Promise<{ id: string; startsAt: Date }> {
  const slots = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: new Date('2026-11-30T00:00:00Z'),
  });
  const slot = slots.filter((s) => localDateOf(s.startsAt, 'Europe/London') === localDate)[index];
  if (!slot) {
    throw new Error(`No free slot on ${localDate}`);
  }
  return slot;
}

function deps() {
  return { db: database.db, clock, log: logs.log, mail: testMail(mailer) };
}

function sweep() {
  return sendDueReminders({ ...deps(), publicUrl: PUBLIC_URL });
}

async function book(localDate: string, patientId = clinic.patient1.id, index = 0) {
  const slot = await freeSlot(localDate, index);
  const booking = await bookSlot(deps(), { patientId, slotId: slot.id });
  mailer.sent.length = 0; // Drop the confirmation; these tests count reminders.
  return booking;
}

beforeAll(async () => {
  database = await startTestDatabase(10);
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  clock.set(START);
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  logs = captureLogs(clock);
  mailer = recordingMailer();
});

describe('appointment reminders', () => {
  it('sends one reminder about 24 hours before, with the details and links, and never a second', async () => {
    const booking = await book('2026-10-22');
    clock.set(addHours(booking.startsAt, -25));
    expect(await sweep()).toEqual({ enabled: true, claimed: 0, sent: 0, failed: 0 });
    clock.set(addHours(booking.startsAt, -24));
    expect(await sweep()).toEqual({ enabled: true, claimed: 1, sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    const [email] = mailer.sent;
    expect(email!.to).toBe(clinic.patient1.email);
    expect(email!.text).toContain('When: Thursday 22 October 2026 at 09:00 (UK time)');
    expect(email!.text).toContain('With: Pat Physio');
    expect(email!.text).toContain(`https://clinic.example.test/bookings/${booking.id}/reschedule`);
    expect(email!.text).toContain(`https://clinic.example.test/bookings/${booking.id}/cancel`);
    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.reminderSentAt?.toISOString()).toBe(clock.now().toISOString());

    clock.advanceMinutes(60);
    expect((await sweep()).claimed).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect(logs.lines.find((l) => l.event === 'email.reminder.sent')).toMatchObject({ booking_id: booking.id });
    expect(JSON.stringify(logs.lines)).not.toContain(clinic.patient1.email);
  });

  it('still sends a reminder the sweep reaches late, but not once the appointment has started', async () => {
    const early = await book('2026-10-22', clinic.patient1.id, 0);
    const later = await book('2026-10-22', clinic.patient2.id, 4);
    clock.set(addHours(early.startsAt, 1));
    await sweep();
    expect(mailer.sent.map((m) => m.to)).toEqual([clinic.patient2.email]);
    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, later.id));
    expect(row?.reminderSentAt).not.toBeNull();
  });

  it('sends nothing for a cancelled booking', async () => {
    const booking = await book('2026-10-22');
    await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id });
    clock.set(addHours(booking.startsAt, -2));
    expect((await sweep()).claimed).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('reminds a moved booking about its new time, when the new time is due', async () => {
    const booking = await book('2026-10-22');
    const target = await freeSlot('2026-10-26', 2);
    await rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target.id });
    clock.set(addHours(booking.startsAt, -23));
    expect((await sweep()).claimed).toBe(0);
    clock.set(addHours(target.startsAt, -23));
    expect((await sweep()).sent).toBe(1);
    // 26 October is after the clocks go back; the email shows the wall-clock time.
    expect(mailer.sent[0]!.text).toContain('When: Monday 26 October 2026 at 10:30 (UK time)');
  });

  it('reminds a booking moved to less than 24 hours away, since no other email confirms the move', async () => {
    const booking = await book('2026-10-23');
    clock.set('2026-10-21T12:00:00Z');
    const target = await freeSlot('2026-10-22', 3);
    await rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target.id });
    expect((await sweep()).sent).toBe(1);
    expect(mailer.sent[0]!.text).toContain('When: Thursday 22 October 2026 at 11:15 (UK time)');
  });

  it('skips a booking made less than 24 hours ahead: its confirmation was just sent', async () => {
    clock.set('2026-10-21T12:00:00Z');
    await book('2026-10-22');
    expect((await sweep()).claimed).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('sends nothing while the clinic has reminders switched off, and resumes when switched on', async () => {
    const booking = await book('2026-10-22');
    await saveClinicSettings(database.db, clock, { ...clinic.settings, appointmentReminders: false });
    clock.set(addHours(booking.startsAt, -20));
    expect(await sweep()).toEqual({ enabled: false, claimed: 0, sent: 0, failed: 0 });
    expect(mailer.sent).toHaveLength(0);
    await saveClinicSettings(database.db, clock, { ...clinic.settings, appointmentReminders: true });
    expect((await sweep()).sent).toBe(1);
  });

  it('never sends twice when sweeps overlap', async () => {
    const first = await book('2026-10-22', clinic.patient1.id, 0);
    await book('2026-10-22', clinic.patient2.id, 0); // The next slot, 45 minutes later.
    clock.set(addHours(first.startsAt, -23));
    const results = await Promise.all([sweep(), sweep(), sweep(), sweep()]);
    expect(results.reduce((total, r) => total + r.sent, 0)).toBe(2);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([clinic.patient1.email, clinic.patient2.email].sort());
  });

  it('does not retry a reminder whose email failed, and logs the failure', async () => {
    const booking = await book('2026-10-22');
    clock.set(addHours(booking.startsAt, -23));
    const failing = { kind: 'recording' as const, send: () => Promise.reject(new Error('SMTP down')) };
    const result = await sendDueReminders({ ...deps(), mail: testMail(failing), publicUrl: PUBLIC_URL });
    expect(result).toEqual({ enabled: true, claimed: 1, sent: 0, failed: 1 });
    expect(logs.events()).toContain('email.reminder.failed');
    expect((await sweep()).claimed).toBe(0);
  });
});
