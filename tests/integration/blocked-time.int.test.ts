import { and, eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { bookings, practitionerBlocks } from '@/db/schema';
import { listBlockedPeriods, saveBlockedPeriod } from '@/server/admin/blocked-time';
import { bookSlot } from '@/server/bookings/book';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSession, findSessionUser } from '@/server/auth/session';
import { listAvailableSlots, isSlotFree, type SlotView } from '@/server/slots/queries';
import { addMinutes, localDateOf, formatLocalTime } from '@/lib/time';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
let foreign: TestDatabase;
let clinic: SeededClinic;
const mailer = recordingMailer();
const deps = () => ({ db: database.db, clock, log: captureLogs(clock).log, mail: testMail(mailer) });
const local = (instant: Date) =>
  `${localDateOf(instant, 'Europe/London')}T${formatLocalTime(instant, 'Europe/London')}`;
const inputFor = (slot: SlotView, start = slot.startsAt, end = slot.endsAt) => ({
  practitionerId: slot.practitionerId,
  start: local(start),
  end: local(end),
  reason: 'Fictional training',
});
const freeSlots = () =>
  listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T00:00:00Z'),
    until: new Date('2026-10-23T00:00:00Z'),
  });

beforeAll(async () => {
  database = await startTestDatabase();
  foreign = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
  await foreign?.stop();
});
beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  mailer.sent.length = 0;
});

it('saves blocks over existing data and lists every confirmed overlap without changing any booking', async () => {
  const [a, b, cancelled, boundary] = await freeSlots();
  const first = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: a!.id });
  const second = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: b!.id });
  const third = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: cancelled!.id });
  await database.db
    .update(bookings)
    .set({ status: 'cancelled', cancelledAt: clock.now() })
    .where(eq(bookings.id, third.id));
  const before = await database.db.select().from(bookings);
  await saveBlockedPeriod(database.db, clock, inputFor(a!, addMinutes(a!.endsAt, -1), cancelled!.endsAt));
  const [period] = await listBlockedPeriods(database.db);
  expect(period!.bookings.map((row) => row.bookingId)).toEqual([first.id, second.id]);
  expect(await database.db.select().from(bookings)).toEqual(before);
  expect(await isSlotFree(database.db, boundary!.id)).toBe(true);
  expect(mailer.sent).toHaveLength(3);
});

it('removes partial overlaps, keeps touching slots and other practitioners, and refuses stale bookings and moves', async () => {
  const [before, target, after, original] = await freeSlots();
  const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original!.id });
  await saveBlockedPeriod(
    database.db,
    clock,
    inputFor(target!, addMinutes(target!.startsAt, 1), addMinutes(target!.endsAt, -1)),
  );
  expect((await freeSlots()).map((slot) => slot.id)).not.toContain(target!.id);
  expect(await isSlotFree(database.db, target!.id)).toBe(false);
  expect(await isSlotFree(database.db, before!.id)).toBe(true);
  expect(await isSlotFree(database.db, after!.id)).toBe(true);
  expect(
    await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.saturdays,
      after: new Date('2026-10-22T00:00:00Z'),
      until: new Date('2026-10-23T00:00:00Z'),
    }),
  ).not.toHaveLength(0);
  await expect(bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target!.id })).rejects.toMatchObject({
    code: 'slot_blocked',
  });
  await expect(
    rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target!.id }),
  ).rejects.toMatchObject({ code: 'slot_blocked' });
  const [saved] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
  expect(saved!.slotId).toBe(original!.id);
  expect(saved!.rescheduleCount).toBe(0);
  expect(mailer.sent).toHaveLength(1);
});

it('uses exclusive endpoints and gives an empty warning for a period without confirmed bookings', async () => {
  const [before, target, after] = await freeSlots();
  await saveBlockedPeriod(database.db, clock, { ...inputFor(target!), reason: '' });
  expect(await isSlotFree(database.db, before!.id)).toBe(true);
  expect(await isSlotFree(database.db, target!.id)).toBe(false);
  expect(await isSlotFree(database.db, after!.id)).toBe(true);
  expect((await listBlockedPeriods(database.db))[0]).toMatchObject({ reason: null, bookings: [] });
});

it('cannot save a foreign practitioner, share staff sessions, blocks or warnings across clinic databases', async () => {
  await emptyDatabase(foreign.db);
  await seedClinic(foreign.db, clock);
  const [slot] = await freeSlots();
  const staffSession = await createSession(database.db, clock, clinic.admin.id);
  expect(await findSessionUser(foreign.db, clock, staffSession.token)).toBeNull();
  await expect(saveBlockedPeriod(foreign.db, clock, inputFor(slot!))).rejects.toMatchObject({
    fields: { practitionerId: expect.any(String) },
  });
  await saveBlockedPeriod(database.db, clock, inputFor(slot!));
  expect(await listBlockedPeriods(foreign.db)).toEqual([]);
  expect(await database.db.select().from(practitionerBlocks)).toHaveLength(1);
});

it('serialises a block racing a booking: the booking is refused or included in the warning', async () => {
  const [slot] = await freeSlots();
  const [blocked, booked] = await Promise.allSettled([
    saveBlockedPeriod(database.db, clock, inputFor(slot!)),
    bookSlot(deps(), { patientId: clinic.patient1.id, slotId: slot!.id }),
  ]);
  expect(blocked.status).toBe('fulfilled');
  const [period] = await listBlockedPeriods(database.db);
  if (booked.status === 'fulfilled') expect(period!.bookings.map((row) => row.bookingId)).toContain(booked.value.id);
  else {
    expect(booked.reason).toMatchObject({ code: 'slot_blocked' });
    expect(period!.bookings).toEqual([]);
  }
  expect(await isSlotFree(database.db, slot!.id)).toBe(false);
});

it('waits for an uncommitted block before checking a stale booking or move', async () => {
  const [target, original] = await freeSlots();
  const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original!.id });
  // The same row lock used by saveBlockedPeriod, held until the block commits.
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const block = database.db.transaction(async (tx) => {
    await tx.execute(sql`select id from practitioner where id = ${target!.practitionerId} for update`);
    await tx.insert(practitionerBlocks).values({
      id: '019a0000-0000-7000-8000-000000000099',
      practitionerId: target!.practitionerId,
      startsAt: target!.startsAt,
      endsAt: target!.endsAt,
      createdAt: clock.now(),
    });
    locked();
    await gate;
  });
  await ready;
  const attempts = Promise.allSettled([
    bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target!.id }),
    rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target!.id }),
  ]);
  release();
  await block;
  for (const result of await attempts) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'slot_blocked' });
  }
  expect(
    await database.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, booking.id), eq(bookings.slotId, original!.id))),
  ).toHaveLength(1);
});

it('upgrades a database containing bookings without changing them and can remove a mistaken block safely', async () => {
  const [original, target] = await freeSlots();
  await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original!.id });
  const before = await database.db.select().from(bookings);
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as {
    entries: { when: number }[];
  };
  // Recreate the preceding schema in this disposable database only.
  await database.db.execute(sql`drop table practitioner_block`);
  await database.db.execute(
    sql`delete from drizzle.__drizzle_migrations where created_at = ${journal.entries.at(-1)!.when}`,
  );
  await runMigrations(database.url);
  expect(await database.db.select().from(bookings)).toEqual(before);
  expect(await listBlockedPeriods(database.db)).toEqual([]);
  const blockId = await saveBlockedPeriod(database.db, clock, inputFor(target!));
  expect(await isSlotFree(database.db, target!.id)).toBe(false);
  // Rehearse recovery of one erroneous period, retaining all bookings and other data.
  await database.db.delete(practitionerBlocks).where(eq(practitionerBlocks.id, blockId));
  expect(await isSlotFree(database.db, target!.id)).toBe(true);
  expect(await database.db.select().from(bookings)).toEqual(before);
});
