import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, practitioners } from '@/db/schema';
import { formatLocalTime, localDateOf } from '@/lib/time';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { BookingError } from '@/server/bookings/errors';
import { findBookingForPatient, listBookingsForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { listAvailableSlots, type SlotView } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { recordingMailer, testMail, type RecordingMailer } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
let logs: CapturedLogs;
let deps: BookingDependencies;
let mailer: RecordingMailer;
const clock = manualClock('2026-10-20T07:00:00Z');

async function slotsOn(localDate: string, practitionerId = clinic.practitioners.weekdays): Promise<SlotView[]> {
  const slots = await listAvailableSlots(database.db, {
    practitionerId,
    after: clock.now(),
    until: new Date('2027-06-30T00:00:00Z'),
  });
  return slots.filter((s) => localDateOf(s.startsAt, 'Europe/London') === localDate);
}

async function slotAt(localDate: string, localTime: string): Promise<SlotView> {
  const slot = (await slotsOn(localDate)).find((s) => formatLocalTime(s.startsAt, 'Europe/London') === localTime);
  if (!slot) {
    throw new Error(`No free slot at ${localDate} ${localTime}`);
  }
  return slot;
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'none';
  } catch (error) {
    if (error instanceof BookingError) {
      return `${error.code} ${error.status}`;
    }
    throw error;
  }
}

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
  logs = captureLogs(clock);
  mailer = recordingMailer();
  deps = { db: database.db, clock, log: logs.log, mail: testMail(mailer) };
});

describe('booking a slot (REQ-18.1-01)', () => {
  it('confirms a booking with the clock time, an optional phone number and a log line', async () => {
    const slot = await slotAt('2026-10-22', '10:30');
    const booking = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: slot.id,
      phone: ' +44 7700 900001 ',
    });
    expect(booking).toMatchObject({
      status: 'confirmed',
      lateCancellation: false,
      phone: '+44 7700 900001',
      rescheduleCount: 0,
      slotId: slot.id,
      practitionerName: 'Pat Physio',
    });
    expect(booking.createdAt.toISOString()).toBe('2026-10-20T07:00:00.000Z');
    const withoutPhone = await bookSlot(deps, {
      patientId: clinic.patient2.id,
      slotId: (await slotAt('2026-10-22', '11:15')).id,
    });
    expect(withoutPhone.phone).toBeNull();
    expect(logs.lines.filter((l) => l.event === 'booking.confirmed')).toEqual([
      expect.objectContaining({
        booking_id: booking.id,
        slot_id: slot.id,
        phone_given: true,
        time: '2026-10-20T07:00:00.000Z',
      }),
      expect.objectContaining({ booking_id: withoutPhone.id, phone_given: false }),
    ]);
    expect(JSON.stringify(logs.lines)).not.toContain('7700');
  });

  it('refuses slots that are booked, started, beyond the horizon or unknown', async () => {
    const slot = await slotAt('2026-10-22', '10:30');
    await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id });
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient2.id, slotId: slot.id }))).toBe(
      'slot_unavailable 409',
    );
    clock.set('2026-10-22T09:31:00Z');
    const started = await slotAt('2026-10-22', '11:15');
    clock.set('2026-10-22T10:15:00Z');
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient2.id, slotId: started.id }))).toBe(
      'slot_in_past 409',
    );
    expect(
      await refusalOf(
        bookSlot(deps, { patientId: clinic.patient2.id, slotId: '019a0000-0000-7000-8000-000000000000' }),
      ),
    ).toBe('slot_not_found 404');
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient2.id, slotId: 'not-a-uuid' }))).toBe(
      'slot_not_found 404',
    );
  });

  it('refuses a slot beyond the booking horizon', async () => {
    // 15:45 local on 27 May 2027 is inside the horizon from 20 October 2026
    // but beyond the horizon from one day earlier.
    const farSlot = (await slotsOn('2027-05-27')).at(-1)!;
    clock.set('2026-10-19T07:00:00Z');
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient1.id, slotId: farSlot.id }))).toBe(
      'slot_beyond_horizon 422',
    );
  });

  it('refuses an admin, an invalid phone number and an inactive practitioner', async () => {
    const slot = await slotAt('2026-10-22', '10:30');
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.admin.id, slotId: slot.id }))).toBe('not_a_patient 403');
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id, phone: 'call me' }))).toBe(
      'invalid_phone 422',
    );
    await database.db
      .update(practitioners)
      .set({ active: false })
      .where(eq(practitioners.id, clinic.practitioners.weekdays));
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id }))).toBe(
      'slot_not_found 404',
    );
  });
});

describe('cancelling a booking (REQ-18.1-01)', () => {
  it('cancels outside the late window without the late flag', async () => {
    const booking = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: (await slotAt('2026-10-23', '09:00')).id,
    });
    clock.advanceMinutes(30);
    const result = await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect(result).toMatchObject({ ok: true, late: false });
    expect(result.booking).toMatchObject({ status: 'cancelled', lateCancellation: false });
    expect(result.booking.cancelledAt?.toISOString()).toBe('2026-10-20T07:30:00.000Z');
    expect(logs.events()).toEqual(['booking.confirmed', 'email.confirmation.sent', 'booking.cancelled']);
  });

  it('a late cancellation sets the status to cancelled and flags it late', async () => {
    // Starts at 10:15 UTC, about three hours after the clock: inside the 24-hour window.
    const slot = await slotAt('2026-10-20', '11:15');
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id });
    clock.set('2026-10-20T07:15:00Z');
    const result = await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect(result).toMatchObject({ ok: true, late: true });
    const [stored] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(stored).toMatchObject({ status: 'cancelled', lateCancellation: true });
    expect(logs.events()).toEqual([
      'booking.confirmed',
      'email.confirmation.sent',
      'booking.cancel.late',
      'booking.cancelled',
    ]);
  });

  it('refuses to cancel after the start, twice, or for another patient', async () => {
    const booking = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: (await slotAt('2026-10-21', '09:00')).id,
    });
    expect(await refusalOf(cancelBooking(deps, { patientId: clinic.patient2.id, bookingId: booking.id }))).toBe(
      'booking_not_found 404',
    );
    clock.set('2026-10-21T08:00:00Z');
    expect(await refusalOf(cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id }))).toBe(
      'booking_already_started 409',
    );
    clock.set('2026-10-21T08:30:00Z');
    expect(await refusalOf(cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id }))).toBe(
      'booking_already_started 409',
    );
  });

  it('refuses to cancel a booking that is already cancelled', async () => {
    const booking = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: (await slotAt('2026-10-23', '09:45')).id,
    });
    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect(await refusalOf(cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id }))).toBe(
      'booking_not_active 409',
    );
  });
});

describe('rescheduling a booking (REQ-18.1-01)', () => {
  it('moves the booking to another free slot and frees the old one', async () => {
    const original = await slotAt('2026-10-22', '09:00');
    const target = await slotAt('2026-10-27', '14:15');
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: original.id });
    clock.advanceMinutes(5);
    const moved = await rescheduleBooking(deps, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target.id,
    });
    expect(moved).toMatchObject({ slotId: target.id, status: 'confirmed', rescheduleCount: 1 });
    expect(moved.updatedAt.toISOString()).toBe('2026-10-20T07:05:00.000Z');
    expect((await slotsOn('2026-10-22')).map((s) => s.id)).toContain(original.id);
    expect((await slotsOn('2026-10-27')).map((s) => s.id)).not.toContain(target.id);
    expect(logs.lines.at(-1)).toMatchObject({
      event: 'booking.rescheduled',
      from_slot_id: original.id,
      to_slot_id: target.id,
      reschedule_count: 1,
    });
  });

  it('allows the clinic limit of reschedules and refuses the next one', async () => {
    const booking = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: (await slotAt('2026-10-22', '09:00')).id,
    });
    for (const time of ['09:45', '10:30', '11:15']) {
      await rescheduleBooking(deps, {
        patientId: clinic.patient1.id,
        bookingId: booking.id,
        newSlotId: (await slotAt('2026-10-22', time)).id,
      });
    }
    expect(
      await refusalOf(
        rescheduleBooking(deps, {
          patientId: clinic.patient1.id,
          bookingId: booking.id,
          newSlotId: (await slotAt('2026-10-22', '12:00')).id,
        }),
      ),
    ).toBe('reschedule_limit_reached 409');
    expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.rescheduleCount).toBe(3);
  });

  it('refuses a taken slot, the same slot, a started booking and another patient', async () => {
    const mine = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: (await slotAt('2026-10-22', '09:00')).id,
    });
    const theirs = await bookSlot(deps, {
      patientId: clinic.patient2.id,
      slotId: (await slotAt('2026-10-22', '09:45')).id,
    });
    expect(
      await refusalOf(
        rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: mine.id, newSlotId: theirs.slotId }),
      ),
    ).toBe('slot_unavailable 409');
    expect(
      await refusalOf(
        rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: mine.id, newSlotId: mine.slotId }),
      ),
    ).toBe('same_slot 422');
    expect(
      await refusalOf(
        rescheduleBooking(deps, {
          patientId: clinic.patient2.id,
          bookingId: mine.id,
          newSlotId: (await slotAt('2026-10-22', '10:30')).id,
        }),
      ),
    ).toBe('booking_not_found 404');
    const later = (await slotAt('2026-10-23', '09:00')).id;
    clock.set('2026-10-22T08:00:00Z');
    expect(
      await refusalOf(rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: mine.id, newSlotId: later })),
    ).toBe('booking_already_started 409');
    const unchanged = await listBookingsForPatient(database.db, clinic.patient1.id);
    expect(unchanged.map((b) => [b.slotId, b.rescheduleCount])).toEqual([[mine.slotId, 0]]);
  });
});
