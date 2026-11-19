import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blockOuts, bookings } from '@/db/schema';
import { newId } from '@/lib/ids';
import { saveBlockOut } from '@/server/admin/block-outs';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { loadDayView } from '@/server/slots/day-view';
import { isSlotFree } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
let clinic: SeededClinic;
const date = '2026-10-20';

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 14, lateCancellationHours: 0 } });
});

function blockInput() {
  return {
    practitionerId: clinic.practitioners.weekdays,
    startsAt: `${date}T09:45`,
    endsAt: `${date}T10:15`,
  };
}

async function slotsFor(practitionerId = clinic.practitioners.weekdays) {
  return (await loadDayView(database.db, clock, { practitionerId, date })).slots;
}

function bookingDeps() {
  return { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
}

describe('physiotherapist block-outs', () => {
  it('saves a block-out for one physiotherapist with an optional reason', async () => {
    const result = await saveBlockOut(database.db, clock, { ...blockInput(), reason: '  Training  ' });
    expect(result).toMatchObject({ saved: { practitionerName: 'Pat Physio', reason: 'Training', conflicts: [] } });
    await saveBlockOut(database.db, clock, {
      ...blockInput(),
      startsAt: '2026-10-23T16:00',
      endsAt: '2026-10-26T10:00',
    });
    expect(await database.db.select().from(blockOuts).orderBy(asc(blockOuts.startsAt))).toMatchObject([
      {
        practitionerId: clinic.practitioners.weekdays,
        startsAt: new Date('2026-10-20T08:45:00Z'),
        endsAt: new Date('2026-10-20T09:15:00Z'),
        reason: 'Training',
      },
      {
        practitionerId: clinic.practitioners.weekdays,
        startsAt: new Date('2026-10-23T15:00:00Z'),
        endsAt: new Date('2026-10-26T10:00:00Z'),
        reason: null,
      },
    ]);
  });

  it('refuses invalid periods and unknown physiotherapists without saving', async () => {
    const input = blockInput();
    await expect(saveBlockOut(database.db, clock, { ...input, practitionerId: newId(clock) })).resolves.toEqual({
      error: 'invalid_practitioner',
    });
    await expect(saveBlockOut(database.db, clock, { ...input, startsAt: '2026-02-30T09:45' })).resolves.toEqual({
      error: 'invalid_start',
    });
    await expect(saveBlockOut(database.db, clock, { ...input, endsAt: '2027-03-28T01:30' })).resolves.toEqual({
      error: 'invalid_end',
    });
    for (const endsAt of [input.startsAt, `${date}T09:00`]) {
      await expect(saveBlockOut(database.db, clock, { ...input, endsAt })).resolves.toEqual({ error: 'invalid_range' });
    }
    await expect(saveBlockOut(database.db, clock, { ...input, reason: 'x'.repeat(501) })).resolves.toEqual({
      error: 'invalid_reason',
    });
    expect(await database.db.select().from(blockOuts)).toEqual([]);
  });

  it('hides overlapping slots while leaving adjacent slots and other physiotherapists available', async () => {
    const before = await slotsFor();
    const otherPractitioner = await slotsFor(clinic.practitioners.saturdays);
    expect(before).toHaveLength(10);
    expect(otherPractitioner.length).toBeGreaterThan(0);
    await saveBlockOut(database.db, clock, { ...blockInput(), endsAt: `${date}T11:15` });
    expect(await slotsFor()).toEqual([before[0], ...before.slice(3)]);
    expect(await slotsFor(clinic.practitioners.saturdays)).toEqual(otherPractitioner);
    expect(await isSlotFree(database.db, before[1]!.id)).toBe(false);
    expect(await isSlotFree(database.db, before[3]!.id)).toBe(true);
  });

  it('lists only overlapping confirmed bookings and leaves every booking unchanged', async () => {
    const [first, second, third, fourth] = await slotsFor();
    const [otherPractitionerSlot] = await slotsFor(clinic.practitioners.saturdays);
    const deps = bookingDeps();
    const patientId = clinic.patient1.id;
    const firstBooking = await bookSlot(deps, { patientId, slotId: first!.id });
    const cancelledBooking = await bookSlot(deps, { patientId, slotId: second!.id });
    await cancelBooking(deps, { patientId, bookingId: cancelledBooking.id });
    const thirdBooking = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: third!.id });
    await bookSlot(deps, { patientId, slotId: fourth!.id });
    await bookSlot(deps, { patientId, slotId: otherPractitionerSlot!.id });
    const before = await database.db.select().from(bookings).orderBy(asc(bookings.id));

    const result = await saveBlockOut(database.db, clock, {
      ...blockInput(),
      startsAt: `${date}T09:15`,
      endsAt: `${date}T11:15`,
    });

    expect(result).toMatchObject({
      saved: {
        conflicts: [
          { id: firstBooking.id, patientName: clinic.patient1.name, startsAt: first!.startsAt, endsAt: first!.endsAt },
          { id: thirdBooking.id, patientName: clinic.patient2.name, startsAt: third!.startsAt, endsAt: third!.endsAt },
        ],
      },
    });
    expect(await database.db.select().from(bookings).orderBy(asc(bookings.id))).toEqual(before);
  });

  it('refuses to book or move into a block-out and keeps the original booking', async () => {
    const [available, blocked, next] = await slotsFor();
    const deps = bookingDeps();
    const patientId = clinic.patient1.id;
    const original = await bookSlot(deps, { patientId, slotId: available!.id });
    const before = await database.db.select().from(bookings);
    await saveBlockOut(database.db, clock, blockInput());

    await expect(bookSlot(deps, { patientId: clinic.patient2.id, slotId: blocked!.id })).rejects.toMatchObject({
      code: 'slot_blocked',
    });
    await expect(
      rescheduleBooking(deps, { patientId, bookingId: original.id, newSlotId: blocked!.id }),
    ).rejects.toMatchObject({ code: 'slot_blocked' });
    expect(await database.db.select().from(bookings)).toEqual(before);
    await expect(
      rescheduleBooking(deps, { patientId, bookingId: original.id, newSlotId: next!.id }),
    ).resolves.toMatchObject({ slotId: next!.id, status: 'confirmed' });
  });

  it('either warns about a simultaneous booking or refuses it', async () => {
    const [, target] = await slotsFor();
    const deps = bookingDeps();
    const [block, booking] = await Promise.all([
      saveBlockOut(database.db, clock, blockInput()),
      bookSlot(deps, { patientId: clinic.patient1.id, slotId: target!.id }).catch((error: unknown) => error),
    ]);
    if (booking instanceof Error) {
      expect(booking).toMatchObject({ code: 'slot_blocked' });
      expect(block).toMatchObject({ saved: { conflicts: [] } });
    } else {
      expect(block).toMatchObject({
        saved: { conflicts: [expect.objectContaining({ patientName: clinic.patient1.name })] },
      });
    }
  });
});
