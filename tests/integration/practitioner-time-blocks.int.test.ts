import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, practitionerTimeBlocks } from '@/db/schema';
import { submitTimeBlock } from '@/server/admin/time-blocks';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { loadDayView } from '@/server/slots/day-view';
import { isSlotFree } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');
const date = '2026-10-20';

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7, lateCancellationHours: 0 } });
});

function fields(startsAt = '09:55', endsAt = '11:15', reason = 'Training') {
  return {
    practitionerId: clinic.practitioners.weekdays,
    startsAt: `${date}T${startsAt}`,
    endsAt: `${date}T${endsAt}`,
    reason,
  };
}

function deps() {
  return { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
}

function dayView(practitionerId = clinic.practitioners.weekdays) {
  return loadDayView(database.db, clock, { practitionerId, date });
}

async function review(draft = fields()) {
  const result = await submitTimeBlock(database.db, clock, draft);
  if (result.status !== 'review') throw new Error(`Expected review, got ${result.status}`);
  return result;
}

describe('practitioner time blocks', () => {
  it('saves the chosen practitioner, clinic times and optional reason after review', async () => {
    const draft = fields();
    const { confirmation } = await review(draft);
    expect(await database.db.select().from(practitionerTimeBlocks)).toEqual([]);
    const saved = await submitTimeBlock(database.db, clock, draft, confirmation);
    expect(saved).toEqual({ status: 'saved', id: confirmation.id });
    expect(await submitTimeBlock(database.db, clock, draft, confirmation)).toEqual(saved);
    expect(await database.db.select().from(practitionerTimeBlocks)).toEqual([
      {
        id: confirmation.id,
        practitionerId: clinic.practitioners.weekdays,
        startsAt: new Date(`${date}T08:55:00Z`),
        endsAt: new Date(`${date}T10:15:00Z`),
        reason: 'Training',
        createdAt: clock.now(),
      },
    ]);
    const noReason = { ...fields('13:00', '14:00', ''), practitionerId: clinic.practitioners.saturdays };
    const next = await review(noReason);
    expect(await submitTimeBlock(database.db, clock, noReason, next.confirmation)).toMatchObject({ status: 'saved' });
    expect(await database.db.select().from(practitionerTimeBlocks)).toContainEqual(
      expect.objectContaining({ id: next.confirmation.id, practitionerId: noReason.practitionerId, reason: null }),
    );
  });

  it('offers no overlapping slots and keeps adjoining slots and other practitioners available', async () => {
    const { slots } = await dayView();
    const otherPractitioner = clinic.practitioners.saturdays;
    const otherBefore = (await dayView(otherPractitioner)).slots;
    expect(otherBefore.length).toBeGreaterThan(0);
    for (const draft of [fields(), fields('12:00', '12:10')]) {
      const { confirmation } = await review(draft);
      expect(await submitTimeBlock(database.db, clock, draft, confirmation)).toMatchObject({ status: 'saved' });
    }
    const blocked = [slots[1]!, slots[2]!, slots[4]!];
    expect((await dayView()).slots).toEqual(slots.filter((slot) => !blocked.includes(slot)));
    expect((await dayView(otherPractitioner)).slots).toEqual(otherBefore);
    expect(await isSlotFree(database.db, slots[1]!.id)).toBe(false);
    expect(await isSlotFree(database.db, slots[3]!.id)).toBe(true);
  });

  it('previews affected confirmed bookings with client contact details and session times before saving', async () => {
    const { slots } = await dayView();
    const selected = slots[1]!;
    const booking = await bookSlot(deps(), {
      slotId: selected.id,
      patientId: clinic.patient1.id,
      phone: clinic.patient1.phone,
    });
    const cancelled = await bookSlot(deps(), { slotId: slots[2]!.id, patientId: clinic.patient2.id });
    await cancelBooking(deps(), { patientId: clinic.patient2.id, bookingId: cancelled.id });
    await bookSlot(deps(), { slotId: slots[3]!.id, patientId: clinic.patient2.id });
    await bookSlot(deps(), {
      slotId: (await dayView(clinic.practitioners.saturdays)).slots[0]!.id,
      patientId: clinic.patient2.id,
    });

    expect((await review()).bookings).toEqual([
      {
        id: booking.id,
        patientName: clinic.patient1.name,
        patientEmail: clinic.patient1.email,
        phone: clinic.patient1.phone,
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
      },
    ]);
    expect(await database.db.select().from(practitionerTimeBlocks)).toEqual([]);
  });

  it('leaves affected bookings in place and confirmed when a block is saved', async () => {
    const { slots } = await dayView();
    const booking = await bookSlot(deps(), { slotId: slots[1]!.id, patientId: clinic.patient1.id });
    const before = await database.db.select().from(bookings);
    const { confirmation } = await review();
    expect(await submitTimeBlock(database.db, clock, fields(), confirmation)).toMatchObject({ status: 'saved' });
    expect(await database.db.select().from(bookings)).toEqual(before);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booking.id)).toEqual(booking);
  });

  it('refuses stale booking and move requests for a blocked slot and keeps the original session', async () => {
    const { slots } = await dayView();
    const booking = await bookSlot(deps(), { slotId: slots[0]!.id, patientId: clinic.patient1.id });
    const target = slots[1]!.id;
    const { confirmation } = await review();
    await submitTimeBlock(database.db, clock, fields(), confirmation);

    await expect(bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target })).rejects.toMatchObject({
      code: 'slot_blocked',
    });
    await expect(
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target }),
    ).rejects.toMatchObject({ code: 'slot_blocked' });
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booking.id)).toEqual(booking);
  });

  it('asks staff to review again if a booking arrives before the block is saved', async () => {
    const { slots } = await dayView();
    const first = await review();
    const booked = await bookSlot(deps(), { slotId: slots[1]!.id, patientId: clinic.patient1.id });
    const result = await submitTimeBlock(database.db, clock, fields(), first.confirmation);
    expect(result).toMatchObject({ status: 'review', changed: true, bookings: [{ id: booked.id }] });
    expect(await database.db.select().from(practitionerTimeBlocks)).toEqual([]);
  });

  it('either rejects a concurrent booking or includes it in the review before saving', async () => {
    const { slots } = await dayView();
    const { confirmation } = await review();
    const [save, book] = await Promise.allSettled([
      submitTimeBlock(database.db, clock, fields(), confirmation),
      bookSlot(deps(), { slotId: slots[1]!.id, patientId: clinic.patient1.id }),
    ]);
    if (book.status === 'fulfilled') {
      expect(save).toMatchObject({
        status: 'fulfilled',
        value: { status: 'review', bookings: [{ id: book.value.id }] },
      });
    } else {
      expect(book.reason).toMatchObject({ code: 'slot_blocked' });
      expect(save).toMatchObject({ status: 'fulfilled', value: { status: 'saved' } });
    }
  });
});
