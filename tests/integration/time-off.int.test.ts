import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatLocalTime, localDateOf } from '@/lib/time';
import { createTimeOff, deleteTimeOff, listCurrentTimeOff, TimeOffInputRejected } from '@/server/admin/time-off';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { BookingError } from '@/server/bookings/errors';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { isSlotFree, listAvailableSlots, type SlotView } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
let deps: BookingDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');

async function freeSlots(localDate: string, practitionerId = clinic.practitioners.weekdays): Promise<SlotView[]> {
  const slots = await listAvailableSlots(database.db, {
    practitionerId,
    after: clock.now(),
    until: new Date('2027-06-30T00:00:00Z'),
  });
  return slots.filter((s) => localDateOf(s.startsAt, 'Europe/London') === localDate);
}

async function slotAt(localDate: string, localTime: string): Promise<SlotView> {
  const slot = (await freeSlots(localDate)).find((s) => formatLocalTime(s.startsAt, 'Europe/London') === localTime);
  if (!slot) throw new Error(`No free slot at ${localDate} ${localTime}`);
  return slot;
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'none';
  } catch (error) {
    if (error instanceof BookingError || error instanceof TimeOffInputRejected) return error.code;
    throw error;
  }
}

async function emptyTimeOff() {
  for (const block of await listCurrentTimeOff(database.db, clock.now())) await deleteTimeOff(database.db, block.id);
}

function blockOut(start: string, end: string, practitionerId = clinic.practitioners.weekdays, reason = '') {
  return createTimeOff(database.db, clock, clinic.admin.id, { practitionerId, start, end, reason });
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
  deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail(recordingMailer()) };
});

describe('practitioner time off', () => {
  it('hides every overlapping slot of that practitioner only, including partly covered ones', async () => {
    const before = (await freeSlots('2026-10-22')).map((s) => formatLocalTime(s.startsAt, 'Europe/London'));
    expect(before).toContain('10:30');
    // 10:00 to 12:00 partly covers the 09:45 slot (until 10:30) and the 11:15 slot (until 12:00).
    await blockOut('2026-10-22T10:00', '2026-10-22T12:00', clinic.practitioners.weekdays, 'Training');
    const after = (await freeSlots('2026-10-22')).map((s) => formatLocalTime(s.startsAt, 'Europe/London'));
    expect(after).not.toEqual(expect.arrayContaining(['09:45', '10:30', '11:15']));
    expect(after).toEqual(before.filter((time) => !['09:45', '10:30', '11:15'].includes(time)));
    expect(after).toContain('09:00');
    expect(after).toContain('12:00');
    // The other practitioner's Thursday is untouched.
    expect((await freeSlots('2026-10-22', clinic.practitioners.saturdays)).length).toBeGreaterThan(0);
  });

  it('refuses to book or reschedule into time off, and offers the slots again once it is removed', async () => {
    const target = await slotAt('2026-10-23', '09:00');
    const elsewhere = await slotAt('2026-10-26', '09:00');
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: elsewhere.id });
    const { id } = await blockOut('2026-10-23T00:00', '2026-10-24T00:00', clinic.practitioners.weekdays, 'Holiday');
    expect(await freeSlots('2026-10-23')).toEqual([]);
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient2.id, slotId: target.id }))).toBe(
      'slot_in_time_off',
    );
    expect(
      await refusalOf(
        rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target.id }),
      ),
    ).toBe('slot_in_time_off');
    expect(await deleteTimeOff(database.db, id)).toBe(true);
    expect(await deleteTimeOff(database.db, id)).toBe(false);
    expect(await isSlotFree(database.db, target.id)).toBe(true);
    expect(await refusalOf(bookSlot(deps, { patientId: clinic.patient2.id, slotId: target.id }))).toBe('none');
  });

  it('lists confirmed bookings in the time off without cancelling them', async () => {
    const inside = await slotAt('2026-10-27', '13:30');
    const outside = await slotAt('2026-10-28', '13:30');
    const cancelledSlot = await slotAt('2026-10-27', '15:00');
    const kept = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: inside.id, phone: '+44 7700 900001' });
    await bookSlot(deps, { patientId: clinic.patient2.id, slotId: outside.id });
    const cancelled = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: cancelledSlot.id });
    await cancelBooking(deps, { patientId: clinic.patient2.id, bookingId: cancelled.id });

    const created = await blockOut('2026-10-27T12:00', '2026-10-27T17:00', clinic.practitioners.weekdays, 'Sick day');
    expect(created.affectedBookings).toEqual([
      {
        bookingId: kept.id,
        patientName: 'Patient One',
        patientEmail: 'patient1@patients.example.test',
        phone: '+44 7700 900001',
        startsAt: inside.startsAt,
      },
    ]);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, kept.id)).toMatchObject({
      status: 'confirmed',
    });
    const [listed] = await listCurrentTimeOff(database.db, clock.now());
    expect(listed).toMatchObject({ id: created.id, reason: 'Sick day', practitionerName: 'Pat Physio' });
    expect(listed?.affectedBookings.map((b) => b.bookingId)).toEqual([kept.id]);
  });

  it('stops listing time off once it has ended, and refuses an unknown practitioner', async () => {
    await blockOut('2026-10-21T09:00', '2026-10-21T17:00');
    expect(await listCurrentTimeOff(database.db, clock.now())).toHaveLength(1);
    expect(await listCurrentTimeOff(database.db, new Date('2026-10-21T16:00:00Z'))).toHaveLength(0);
    expect(
      await refusalOf(blockOut('2026-10-21T09:00', '2026-10-21T17:00', '0190f5e4-0000-7000-8000-000000000099')),
    ).toBe('unknown_practitioner');
  });

  it('never lets a booking made at the same moment go unlisted', async () => {
    for (const time of ['09:00', '09:45', '10:30', '11:15', '12:00']) {
      const slot = await slotAt('2026-11-03', time);
      const [booked, created] = await Promise.allSettled([
        bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id }),
        blockOut(
          `2026-11-03T${time}`,
          `2026-11-03T${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}${time.slice(2)}`,
        ),
      ]);
      expect(created.status).toBe('fulfilled');
      const listed = created.status === 'fulfilled' ? created.value.affectedBookings.map((b) => b.bookingId) : [];
      if (booked.status === 'fulfilled') {
        expect(listed).toEqual([booked.value.id]);
      } else {
        expect((booked.reason as BookingError).code).toBe('slot_in_time_off');
        expect(listed).toEqual([]);
      }
      await emptyTimeOff();
    }
  });
});
