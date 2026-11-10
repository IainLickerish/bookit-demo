import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBlockedTime, bookingsInBlockedTime, removeBlockedTime } from '@/server/admin/blocked-time';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { findBookableSlot, isSlotFree, listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
let deps: BookingDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');
const range = { after: clock.now(), until: new Date('2026-10-23T00:00:00Z') };

beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail(recordingMailer()) };
});

async function free(practitionerId = clinic.practitioners.weekdays) {
  return listAvailableSlots(database.db, { practitionerId, ...range });
}

describe('practitioner absences', () => {
  it('hides partial overlaps, preserves touching slots and other practitioners, and can be undone', async () => {
    const available = await free();
    const target = available[2]!;
    const others = await free(clinic.practitioners.saturdays);
    const id = await createBlockedTime(database.db, clock, {
      practitionerId: target.practitionerId,
      startsAt: new Date(target.startsAt.getTime() + 60_000),
      endsAt: target.endsAt,
      reason: null,
    });
    expect((await free()).map((slot) => slot.id)).toEqual(
      available.filter((slot) => slot.id !== target.id).map((slot) => slot.id),
    );
    expect(await free(clinic.practitioners.saturdays)).toEqual(others);
    expect(await findBookableSlot(database.db, target.id)).toBeNull();
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    await expect(bookSlot(deps, { patientId: clinic.patient1.id, slotId: target.id })).rejects.toMatchObject({
      code: 'slot_not_found',
    });
    const original = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: available[0]!.id });
    await expect(
      rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: original.id, newSlotId: target.id }),
    ).rejects.toMatchObject({ code: 'slot_not_found' });
    await removeBlockedTime(database.db, id);
    expect(await isSlotFree(database.db, target.id)).toBe(true);
  });

  it('lists overlapping confirmed bookings with contact details and keeps them confirmed', async () => {
    const available = await free();
    const booking = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: available[0]!.id,
      phone: '+44 7700 900123',
    });
    const cancelled = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: available[1]!.id });
    await cancelBooking(deps, { patientId: clinic.patient2.id, bookingId: cancelled.id });
    const id = await createBlockedTime(database.db, clock, {
      practitionerId: booking.practitionerId,
      startsAt: available[0]!.startsAt,
      endsAt: available.at(-1)!.endsAt,
      reason: 'Training',
    });
    expect(await bookingsInBlockedTime(database.db, id)).toEqual([
      expect.objectContaining({
        id: booking.id,
        patientName: clinic.patient1.name,
        email: clinic.patient1.email,
        phone: '+44 7700 900123',
      }),
    ]);
    expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.status).toBe('confirmed');
    expect(await free()).toEqual([]);
  });

  it('serialises simultaneous booking and blocking so a booking is either refused or listed', async () => {
    const target = (await free())[0]!;
    const [booking, block] = await Promise.allSettled([
      bookSlot(deps, { patientId: clinic.patient1.id, slotId: target.id }),
      createBlockedTime(database.db, clock, {
        practitionerId: target.practitionerId,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
        reason: null,
      }),
    ]);
    expect(block.status).toBe('fulfilled');
    if (block.status !== 'fulfilled') throw new Error('Block failed');
    const warnings = await bookingsInBlockedTime(database.db, block.value);
    if (booking.status === 'fulfilled') expect(warnings.map((row) => row.id)).toContain(booking.value.id);
    else {
      expect(booking.reason).toMatchObject({ code: 'slot_not_found' });
      expect(warnings).toEqual([]);
    }
    expect(await isSlotFree(database.db, target.id)).toBe(false);
  });
});
