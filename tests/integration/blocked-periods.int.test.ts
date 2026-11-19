import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blockedPeriods } from '@/db/schema';
import { reviewPractitionerBlock, savePractitionerBlock, type BlockFields } from '@/server/admin/blocked-periods';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { loadDayView } from '@/server/slots/day-view';
import { isSlotFree, type SlotView } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
const date = '2026-10-22';
let database: TestDatabase;
let clinic: SeededClinic;
let input: BlockFields;

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7 } });
  input = {
    practitionerId: clinic.practitioners.weekdays,
    start: `${date}T10:10`,
    end: `${date}T11:15`,
    reason: 'Training',
  };
});

async function review(fields = input) {
  const result = await reviewPractitionerBlock(database.db, clock, fields);
  if (!result.review) throw new Error(`Expected a review, got ${result.error}`);
  return result.review;
}

async function daySlots(practitionerId = input.practitionerId) {
  return (await loadDayView(database.db, clock, { practitionerId, date })).slots;
}

function bookingDeps() {
  return { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
}

async function book(slot: SlotView, patientId = clinic.patient1.id) {
  return bookSlot(bookingDeps(), { patientId, slotId: slot.id });
}

describe('practitioner blocked periods', () => {
  it('saves the practitioner, start, end and optional reason once per review', async () => {
    const preview = await review();
    expect(await database.db.select().from(blockedPeriods)).toEqual([]);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await savePractitionerBlock(database.db, clock, input, preview)).toMatchObject({ saved: true });
    }
    const noReason = { ...input, start: `${date}T15:00`, end: `${date}T16:00`, reason: '   ' };
    expect(await savePractitionerBlock(database.db, clock, noReason, await review(noReason))).toMatchObject({
      saved: true,
    });
    expect(await database.db.select().from(blockedPeriods)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          practitionerId: input.practitionerId,
          startsAt: new Date(`${date}T09:10:00Z`),
          endsAt: new Date(`${date}T10:15:00Z`),
          reason: 'Training',
        }),
        expect.objectContaining({ reason: null }),
      ]),
    );
    expect(await database.db.select().from(blockedPeriods)).toHaveLength(2);
  });

  it('hides partially overlapping slots and keeps adjacent slots and other physiotherapists available', async () => {
    const [before, partial, inside, between, next] = await daySlots();
    const otherBefore = await daySlots(clinic.practitioners.saturdays);
    expect(otherBefore.length).toBeGreaterThan(0);
    expect(await savePractitionerBlock(database.db, clock, input, await review())).toMatchObject({ saved: true });
    const later = { ...input, start: `${date}T12:00`, end: `${date}T12:30` };
    expect(await savePractitionerBlock(database.db, clock, later, await review(later))).toMatchObject({ saved: true });
    const offered = (await daySlots()).map(({ id }) => id);
    expect(offered).toContain(before!.id);
    expect(offered).toContain(between!.id);
    expect(offered).not.toContain(partial!.id);
    expect(offered).not.toContain(inside!.id);
    expect(offered).not.toContain(next!.id);
    expect(await isSlotFree(database.db, partial!.id)).toBe(false);
    expect(await daySlots(clinic.practitioners.saturdays)).toEqual(otherBefore);
  });

  it('shows only affected confirmed bookings with client names and session times before saving', async () => {
    const [before, partial, inside] = await daySlots();
    const [other] = await daySlots(clinic.practitioners.saturdays);
    const confirmed = await book(partial!);
    await book(before!);
    await book(other!);
    const cancelled = await book(inside!, clinic.patient2.id);
    await cancelBooking(bookingDeps(), { bookingId: cancelled.id, patientId: clinic.patient2.id });

    const preview = await review();
    expect(preview.affected).toEqual([
      {
        id: confirmed.id,
        patientName: clinic.patient1.name,
        startsAt: partial!.startsAt,
        endsAt: partial!.endsAt,
      },
    ]);
    expect(await database.db.select().from(blockedPeriods)).toEqual([]);
  });

  it('leaves every affected booking in place when a reviewed block is saved', async () => {
    const [, partial, inside] = await daySlots();
    const first = await book(partial!);
    const second = await book(inside!, clinic.patient2.id);
    expect(await savePractitionerBlock(database.db, clock, input, await review())).toMatchObject({ saved: true });
    expect(await findBookingForPatient(database.db, clinic.patient1.id, first.id)).toEqual(first);
    expect(await findBookingForPatient(database.db, clinic.patient2.id, second.id)).toEqual(second);
  });

  it('rejects a stale booking or move into a saved block without changing the original booking', async () => {
    const [before, partial, inside] = await daySlots();
    const original = await book(before!);
    expect(await savePractitionerBlock(database.db, clock, input, await review())).toMatchObject({ saved: true });
    await expect(book(partial!, clinic.patient2.id)).rejects.toMatchObject({ code: 'slot_blocked' });
    await expect(
      rescheduleBooking(bookingDeps(), {
        bookingId: original.id,
        patientId: clinic.patient1.id,
        newSlotId: inside!.id,
      }),
    ).rejects.toMatchObject({ code: 'slot_blocked' });
    expect(await findBookingForPatient(database.db, clinic.patient1.id, original.id)).toEqual(original);
  });

  it('asks staff to review again if a confirmed booking appears before saving', async () => {
    const [, partial] = await daySlots();
    const preview = await review();
    expect(preview.affected).toEqual([]);
    const booking = await book(partial!);
    const next = await savePractitionerBlock(database.db, clock, input, preview);
    expect(next).toMatchObject({ saved: false, review: { affected: [{ id: booking.id }] } });
    expect(await database.db.select().from(blockedPeriods)).toEqual([]);
    expect(await savePractitionerBlock(database.db, clock, input, next.review!)).toMatchObject({ saved: true });
  });

  it('serialises a block and a concurrent booking so staff never miss an affected booking', async () => {
    const [, partial] = await daySlots();
    const preview = await review();
    const [save, booking] = await Promise.all([
      savePractitionerBlock(database.db, clock, input, preview),
      book(partial!).then(
        (confirmed) => ({ confirmed }),
        (error: unknown) => ({ error }),
      ),
    ]);
    if ('confirmed' in booking) {
      expect(save).toMatchObject({ saved: false, review: { affected: [{ id: booking.confirmed.id }] } });
    } else {
      expect(booking.error).toMatchObject({ code: 'slot_blocked' });
      expect(save).toMatchObject({ saved: true });
    }
  });
});
