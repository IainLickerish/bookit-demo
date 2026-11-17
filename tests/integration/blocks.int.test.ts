import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, practitionerBlocks } from '@/db/schema';
import { runMigrations } from '@/db/migrate';
import { newId } from '@/lib/ids';
import { addMinutes, formatLocalTime, localDateOf } from '@/lib/time';
import { listAdminBlocks, listAffectedBookings, saveAdminBlock } from '@/server/admin/blocks';
import { bookSlot } from '@/server/bookings/book';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { ensureSlotsThroughHorizon } from '@/server/slots/ensure';
import { isSlotFree, listAvailableSlots, type SlotView } from '@/server/slots/queries';
import { lockPractitioner } from '@/server/slots/blocks';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

let database: TestDatabase;
let foreign: TestDatabase;
let clinic: SeededClinic;
let choices: SlotView[];
const clock = manualClock('2026-10-20T07:00:00Z');
const mailer = recordingMailer();
const deps = () => ({ db: database.db, clock, log: captureLogs(clock).log, mail: testMail(mailer) });
const local = (instant: Date) =>
  `${localDateOf(instant, 'Europe/London')}T${formatLocalTime(instant, 'Europe/London')}`;
const input = (start: Date, end: Date, reason = '') => ({
  practitionerId: clinic.practitioners.weekdays,
  startsAt: local(start),
  endsAt: local(end),
  reason,
});
const available = () =>
  listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: new Date('2026-10-28T00:00:00Z'),
  });

beforeAll(async () => {
  database = await startTestDatabase();
  foreign = await startTestDatabase();
  await seedClinic(foreign.db, clock, { settings: { slotHorizonDays: 7 } });
});
afterAll(async () => {
  await Promise.all([database?.stop(), foreign?.stop()]);
});
beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7 } });
  choices = await available();
  mailer.sent.length = 0;
});

describe('staff blocked time', () => {
  it('saves optional reasons and removes any overlapping slots, preserving touching boundaries and other practitioners', async () => {
    const [before, target, after] = choices as [SlotView, SlotView, SlotView];
    const otherBefore = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.saturdays,
      after: clock.now(),
      until: new Date('2026-10-28T00:00:00Z'),
    });
    await saveAdminBlock(database.db, clock, input(target.startsAt, target.endsAt, 'Training <private>'));
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    expect(await isSlotFree(database.db, before.id)).toBe(true);
    expect(await isSlotFree(database.db, after.id)).toBe(true);
    expect((await available()).some((slot) => slot.id === target.id)).toBe(false);
    expect(
      await listAvailableSlots(database.db, {
        practitionerId: clinic.practitioners.saturdays,
        after: clock.now(),
        until: new Date('2026-10-28T00:00:00Z'),
      }),
    ).toEqual(otherBefore);
    await ensureSlotsThroughHorizon(database.db, clock);
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    await saveAdminBlock(database.db, clock, input(addMinutes(after.startsAt, 5), addMinutes(after.startsAt, 10)));
    expect(await isSlotFree(database.db, after.id)).toBe(false);
    const saved = await listAdminBlocks(database.db);
    expect(saved.map((block) => block.reason)).toEqual(['Training <private>', null]);
    expect(saved[0]).toMatchObject({ startsAt: target.startsAt, endsAt: target.endsAt });
  });

  it('rejects stale bookings and moves and leaves the original booking and emails unchanged', async () => {
    const [original, target] = choices as [SlotView, SlotView];
    const booked = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original.id });
    await saveAdminBlock(database.db, clock, input(addMinutes(target.startsAt, -5), addMinutes(target.startsAt, 5)));
    await expect(bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target.id })).rejects.toMatchObject({
      code: 'slot_blocked',
    });
    await expect(
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booked.id, newSlotId: target.id }),
    ).rejects.toMatchObject({ code: 'slot_blocked' });
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booked.id)).toEqual(booked);
    expect(mailer.sent).toHaveLength(1);
  });

  it('lists all overlapping confirmed bookings without changing them and excludes cancelled, touching and other-practitioner bookings', async () => {
    const [a, b, c, d] = choices as [SlotView, SlotView, SlotView, SlotView];
    const first = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: a.id });
    const second = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: b.id });
    const cancelled = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: c.id });
    // Set up a cancelled booking without exercising the unrelated cancellation journey.
    await database.db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: clock.now() })
      .where(eq(bookings.id, cancelled.id));
    await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: d.id });
    const other = (
      await listAvailableSlots(database.db, {
        practitionerId: clinic.practitioners.saturdays,
        after: clock.now(),
        until: new Date('2026-10-28T00:00:00Z'),
      })
    )[0]!;
    await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: other.id });
    const before = await database.db.select().from(bookings);
    await saveAdminBlock(database.db, clock, input(addMinutes(a.startsAt, 5), c.endsAt, 'Away'));
    const [block] = await listAdminBlocks(database.db);
    expect((await listAffectedBookings(database.db, block!)).map((row) => row.id)).toEqual([first.id, second.id]);
    expect(await database.db.select().from(bookings)).toEqual(before);
    expect(mailer.sent).toHaveLength(5);
  });

  it('keeps blocks in their own clinic and refuses a foreign practitioner without writing', async () => {
    const target = choices[0]!;
    const foreignBefore = await listAdminBlocks(foreign.db);
    await saveAdminBlock(database.db, clock, input(target.startsAt, target.endsAt, 'Private reason'));
    expect(await listAdminBlocks(foreign.db)).toEqual(foreignBefore);
    await expect(saveAdminBlock(foreign.db, clock, input(target.startsAt, target.endsAt))).rejects.toMatchObject({
      field: 'practitionerId',
    });
    expect(await listAdminBlocks(foreign.db)).toEqual(foreignBefore);
  });

  it.each([
    ['endsAt', { endsAt: '2026-10-20T09:00' }],
    ['startsAt', { startsAt: '2026-02-30T09:00' }],
    ['reason', { reason: 'x'.repeat(501) }],
  ])('refuses invalid %s without saving', async (field, change) => {
    await expect(
      saveAdminBlock(database.db, clock, { ...input(choices[0]!.startsAt, choices[1]!.endsAt), ...change }),
    ).rejects.toMatchObject({ field });
    expect(await listAdminBlocks(database.db)).toEqual([]);
  });

  it('waits for an in-flight block before confirming a booking or move', async () => {
    const [original, target] = choices as [SlotView, SlotView];
    const booked = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original.id });
    let signalInserted!: () => void;
    let release!: () => void;
    const inserted = new Promise<void>((resolve) => {
      signalInserted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = database.db.transaction(async (tx) => {
      await lockPractitioner(tx, target.practitionerId);
      await tx.insert(practitionerBlocks).values({
        id: newId(clock),
        practitionerId: target.practitionerId,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
        reason: 'Concurrent block',
        createdAt: clock.now(),
      });
      signalInserted();
      await released;
    });
    await inserted;
    const attempts = Promise.allSettled([
      bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target.id }),
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booked.id, newSlotId: target.id }),
    ]);
    try {
      await expect
        .poll(async () => {
          const result = await database.db.execute(sql`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query like '%practitioner%'`);
          return Number(result.rows[0]?.count);
        })
        .toBe(2);
    } finally {
      release();
    }
    await writer;
    const results = await attempts;
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'slot_blocked' });
    }
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booked.id)).toEqual(booked);
  });

  it('adds the migration to a clinic containing bookings without changing existing data', async () => {
    const target = choices[0]!;
    const booked = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: target.id });
    // Recreate the previous schema in this disposable database, retaining its bookings.
    await database.db.execute(sql`drop table practitioner_block`);
    await database.db.execute(sql`delete from drizzle.__drizzle_migrations where id =
      (select max(id) from drizzle.__drizzle_migrations)`);
    await runMigrations(database.url);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booked.id)).toEqual(booked);
    await saveAdminBlock(database.db, clock, input(target.startsAt, target.endsAt));
    expect(await listAdminBlocks(database.db)).toHaveLength(1);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booked.id)).toEqual(booked);
  });

  it('shows a booking that wins a race with block creation as an affected confirmed booking', async () => {
    const target = choices[0]!;
    const [booked] = await Promise.all(
      [
        bookSlot(deps(), { patientId: clinic.patient1.id, slotId: target.id }),
        // Both orders are allowed: if the block wins, the booking must be refused.
        saveAdminBlock(database.db, clock, input(target.startsAt, target.endsAt)),
      ].map((attempt) => attempt.catch((error: unknown) => error)),
    );
    const [block] = await listAdminBlocks(database.db);
    const affected = await listAffectedBookings(database.db, block!);
    if (booked && typeof booked === 'object' && 'id' in booked) {
      expect(affected.map((row) => row.id)).toEqual([booked.id]);
    } else {
      expect(booked).toMatchObject({ code: 'slot_blocked' });
      expect(affected).toEqual([]);
    }
    expect(await isSlotFree(database.db, target.id)).toBe(false);
  });
});
