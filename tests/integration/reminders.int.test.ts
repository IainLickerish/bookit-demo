import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, clinicSettings, slots } from '@/db/schema';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { updateAdminSettings } from '@/server/admin/settings';
import { createSession, findSessionUser } from '@/server/auth/session';
import { sendDueReminders, type ReminderDependencies } from '@/server/notifications/reminders';
import { disabledMailer, type Mailer } from '@/server/notifications/mailer';
import { loadClinicSettings } from '@/server/settings';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail, type RecordingMailer } from '../helpers/mail';

let acme: TestDatabase;
let beacon: TestDatabase;
let clinic: SeededClinic;
let mailer: RecordingMailer;
let deps: ReminderDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');

beforeAll(async () => {
  acme = await startTestDatabase();
  beacon = await startTestDatabase();
});
afterAll(async () => {
  await Promise.allSettled([acme?.stop(), beacon?.stop()]);
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(acme.db);
  await emptyDatabase(beacon.db);
  clinic = await seedClinic(acme.db, clock, { settings: { slotHorizonDays: 10 } });
  mailer = recordingMailer();
  deps = {
    db: acme.db,
    clock,
    log: captureLogs(clock, 'acme').log,
    mail: testMail(mailer),
    publicUrl: new URL('https://acme.example.test'),
    tenant: 'acme',
  };
});

async function slotAt(instant: string): Promise<string> {
  const [slot] = await acme.db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.practitionerId, clinic.practitioners.weekdays), eq(slots.startsAt, new Date(instant))));
  if (!slot) throw new Error(`Fixture slot not found: ${instant}`);
  return slot.id;
}
async function book(instant = '2026-10-22T08:00:00Z') {
  return bookSlot(deps, { patientId: clinic.patient1.id, slotId: await slotAt(instant) });
}
function reminders() {
  return mailer.sent.filter((email) => email.subject.startsWith('Booking reminder:'));
}
async function attempt(id: string) {
  return (await acme.db.select().from(bookings).where(eq(bookings.id, id)))[0]?.reminderAttemptedAt;
}
async function switchReminders(enabled: boolean) {
  const settings = await loadClinicSettings(acme.db);
  await updateAdminSettings(acme.db, clock, {
    clinicName: settings.clinicName,
    timeZone: settings.timeZone,
    lateCancellationHours: settings.lateCancellationHours,
    includeContactInConfirmation: settings.includeContactInConfirmation,
    remindersEnabled: enabled,
  });
}

describe('saved reminders and concurrent delivery', () => {
  it('sends exactly once at 24 elapsed hours, including simultaneous workers and a later pass', async () => {
    const booking = await book();
    clock.set('2026-10-21T07:59:59Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    expect(await attempt(booking.id)).toBeNull();
    clock.set('2026-10-21T08:00:00Z');
    await Promise.all(Array.from({ length: 5 }, () => sendDueReminders(deps)));
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]?.text).toContain('Thu, 22 Oct 2026, 09:00');
    expect(reminders()[0]?.text).toContain(`Booking reference: ${booking.id}`);
    expect(await attempt(booking.id)).toEqual(clock.now());
    await sendDueReminders({ ...deps });
    expect(reminders()).toHaveLength(1);
    expect(mailer.sent.filter((email) => email.subject.startsWith('Booking confirmed:'))).toHaveLength(1);
  });

  it('does not remind a cancelled booking or a booking that has started', async () => {
    const cancelled = await book();
    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: cancelled.id });
    const past = await book('2026-10-21T08:00:00Z');
    clock.set('2026-10-21T08:00:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    expect(await attempt(cancelled.id)).toBeNull();
    expect(await attempt(past.id)).toBeNull();
  });

  it('uses the moved time for an unreminded booking and never reminds an already reminded booking again', async () => {
    const booking = await book();
    await rescheduleBooking(deps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: await slotAt('2026-10-23T08:00:00Z'),
    });
    clock.set('2026-10-21T08:00:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    clock.set('2026-10-22T08:00:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]?.text).toContain('Fri, 23 Oct 2026, 09:00');
    await rescheduleBooking(deps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: await slotAt('2026-10-26T09:00:00Z'),
    });
    clock.set('2026-10-25T09:00:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
  });

  it('reminds short-notice bookings, and catches up after downtime only while upcoming', async () => {
    await book('2026-10-20T10:15:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
    await book();
    clock.set('2026-10-22T07:30:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(2);
  });

  it('stops unsent reminders while off and leaves the other clinic enabled and isolated', async () => {
    const other = await seedClinic(beacon.db, clock, {
      settings: { clinicName: 'Beacon Dental', slotHorizonDays: 10 },
    });
    const [otherSlot] = await beacon.db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.practitionerId, other.practitioners.weekdays),
          eq(slots.startsAt, new Date('2026-10-22T08:00:00Z')),
        ),
      );
    const otherMailer = recordingMailer();
    const otherDeps = {
      ...deps,
      db: beacon.db,
      mail: testMail(otherMailer),
      publicUrl: new URL('https://beacon.example.test'),
      tenant: 'beacon',
    };
    const mine = await book();
    const theirs = await bookSlot(otherDeps, { patientId: other.patient1.id, slotId: otherSlot!.id });
    const token = (await createSession(acme.db, clock, clinic.admin.id)).token;
    expect(await findSessionUser(beacon.db, clock, token)).toBeNull();
    const foreignPatient = (await createSession(acme.db, clock, clinic.patient1.id)).token;
    expect(await findSessionUser(beacon.db, clock, foreignPatient)).toBeNull();
    expect(await findBookingForPatient(acme.db, clinic.patient2.id, mine.id)).toBeNull();
    expect(await findBookingForPatient(beacon.db, other.patient1.id, mine.id)).toBeNull();
    expect(await findBookingForPatient(acme.db, clinic.patient1.id, theirs.id)).toBeNull();
    await switchReminders(false);
    expect((await loadClinicSettings(beacon.db)).remindersEnabled).toBe(true);
    clock.set('2026-10-21T08:00:00Z');
    await Promise.all([sendDueReminders(deps), sendDueReminders(otherDeps)]);
    expect(reminders()).toHaveLength(0);
    expect(await attempt(mine.id)).toBeNull();
    const otherReminders = otherMailer.sent.filter((email) => email.subject.startsWith('Booking reminder:'));
    expect(otherReminders).toHaveLength(1);
    expect(otherReminders[0]?.text).toContain('https://beacon.example.test/bookings');
    expect(otherReminders[0]?.text).not.toContain('https://acme.example.test');
    await switchReminders(true);
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
  });

  it('retains a durable attempt even if the mail server accepted the message but its response was lost', async () => {
    const booking = await book();
    clock.set('2026-10-21T08:00:00Z');
    let sends = 0;
    const uncertain: Mailer = {
      kind: 'recording',
      send: async () => {
        sends++;
        // This is a separate connection: the claim must already be committed.
        expect(await attempt(booking.id)).toEqual(clock.now());
        throw new Error('Simulated lost SMTP reply');
      },
    };
    await sendDueReminders({ ...deps, mail: testMail(uncertain) });
    await sendDueReminders({ ...deps, mail: testMail(uncertain) });
    expect(sends).toBe(1);
    expect((await findBookingForPatient(acme.db, clinic.patient1.id, booking.id))?.status).toBe('confirmed');
  });

  it('does not consume reminders while SMTP is disabled', async () => {
    const booking = await book('2026-10-20T10:15:00Z');
    await sendDueReminders({ ...deps, mail: testMail(disabledMailer) });
    expect(await attempt(booking.id)).toBeNull();
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
  });

  it('does not send when the clinic switch or booking changes after a candidate was found', async () => {
    const booking = await book();
    clock.set('2026-10-21T08:00:00Z');
    // Hold settings so the worker can claim, but cannot yet dispatch.
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = acme.db.transaction(async (tx) => {
      await tx.select().from(clinicSettings).for('update');
      locked();
      await gate;
      await tx.update(clinicSettings).set({ remindersEnabled: false });
      await tx
        .update(bookings)
        .set({ slotId: await slotAt('2026-10-23T08:00:00Z') })
        .where(eq(bookings.id, booking.id));
    });
    await ready;
    const sending = sendDueReminders(deps);
    await expect.poll(() => attempt(booking.id)).not.toBeNull();
    release();
    await holding;
    await sending;
    expect(reminders()).toHaveLength(0);
    expect(await attempt(booking.id)).toBeNull();
    await switchReminders(true);
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(0);
    clock.set('2026-10-22T08:00:00Z');
    await sendDueReminders(deps);
    expect(reminders()).toHaveLength(1);
  });
});
