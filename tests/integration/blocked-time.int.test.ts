import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '@/db/client';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blockedCancellations, blockedPeriods, bookings, slots } from '@/db/schema';
import {
  confirmBlockedTime,
  listBlockCancellations,
  listBlockedTime,
  reviewBlockedTime,
} from '@/server/admin/blocked-time';
import { bookSlot } from '@/server/bookings/book';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { isSlotFree, listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, POSTGRES_IMAGE, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let foreign: TestDatabase;
let clinic: SeededClinic;
let foreignClinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');
const values = () => ({
  practitionerId: clinic.practitioners.weekdays,
  start: '2026-10-22T09:10',
  end: '2026-10-22T09:20',
  reason: 'Training',
});
const deps = () => ({ db: database.db, clock, log: captureLogs(clock).log, mail: testMail() });
async function targetSlot() {
  const [slot] = await database.db
    .select()
    .from(slots)
    .where(
      and(
        eq(slots.practitionerId, clinic.practitioners.weekdays),
        eq(slots.startsAt, new Date('2026-10-22T08:00:00Z')),
      ),
    );
  return slot!;
}
async function confirm(input = values()) {
  const checked = await reviewBlockedTime(database.db, clock, clinic.admin.id, input);
  const id = randomUUID();
  await confirmBlockedTime(database.db, clock, clinic.admin.id, input, id, checked.snapshot);
  return { id, checked };
}

beforeAll(async () => {
  database = await startTestDatabase();
  foreign = await startTestDatabase();
  foreignClinic = await seedClinic(foreign.db, clock, { settings: { slotHorizonDays: 7 } });
});
afterAll(async () => {
  await Promise.all([database?.stop(), foreign?.stop()]);
});
beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7 } });
});

describe('staff blocked time and cancellations', () => {
  it('reviews without writing, then saves the block and linked cancellations, including partial overlap', async () => {
    const target = await targetSlot();
    const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: target.id });
    const checked = await reviewBlockedTime(database.db, clock, clinic.admin.id, values());
    expect(checked.affected.map((b) => b.id)).toEqual([booking.id]);
    expect(await database.db.select().from(blockedPeriods)).toHaveLength(0);
    expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.status).toBe('confirmed');
    const id = randomUUID();
    await confirmBlockedTime(database.db, clock, clinic.admin.id, values(), id, checked.snapshot);
    expect(await listBlockedTime(database.db, clinic.admin.id)).toHaveLength(1);
    expect(await listBlockCancellations(database.db, clinic.admin.id, id)).toMatchObject([{ id: booking.id }]);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booking.id)).toMatchObject({
      status: 'cancelled',
      lateCancellation: false,
      cancelledAt: clock.now(),
    });
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    await confirmBlockedTime(database.db, clock, clinic.admin.id, values(), id, checked.snapshot);
    expect(await database.db.select().from(blockedPeriods)).toHaveLength(1);
    expect(await database.db.select().from(blockedCancellations)).toHaveLength(1);
  });

  it('requires a new review when a booking arrives or moves after preview', async () => {
    const checked = await reviewBlockedTime(database.db, clock, clinic.admin.id, values());
    const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await targetSlot()).id });
    await expect(
      confirmBlockedTime(database.db, clock, clinic.admin.id, values(), randomUUID(), checked.snapshot),
    ).rejects.toMatchObject({ code: 'changed' });
    expect(await database.db.select().from(blockedPeriods)).toHaveLength(0);
    expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.status).toBe('confirmed');
    const second = await reviewBlockedTime(database.db, clock, clinic.admin.id, values());
    const available = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.weekdays,
      after: new Date('2026-10-23T07:00:00Z'),
      until: new Date('2026-10-23T18:00:00Z'),
    });
    await rescheduleBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: available[0]!.id,
    });
    await expect(
      confirmBlockedTime(database.db, clock, clinic.admin.id, values(), randomUUID(), second.snapshot),
    ).rejects.toMatchObject({ code: 'changed' });
  });

  it('rolls back both the block and cancellations when any save fails', async () => {
    const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await targetSlot()).id });
    await database.db.execute(
      sql`create function reject_block_link() returns trigger language plpgsql as $$ begin raise exception 'test refusal'; end $$`,
    );
    await database.db.execute(
      sql`create trigger reject_block_link before insert on blocked_cancellation for each row execute function reject_block_link()`,
    );
    try {
      await expect(confirm()).rejects.toThrow();
      expect(await database.db.select().from(blockedPeriods)).toHaveLength(0);
      expect(await database.db.select().from(blockedCancellations)).toHaveLength(0);
      expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.status).toBe('confirmed');
    } finally {
      await database.db.execute(sql`drop trigger reject_block_link on blocked_cancellation`);
      await database.db.execute(sql`drop function reject_block_link()`);
    }
  });

  it('denies patients and other clinic staff access and refuses foreign practitioner selectors', async () => {
    for (const staffId of [clinic.patient1.id, foreignClinic.admin.id]) {
      await expect(reviewBlockedTime(database.db, clock, staffId, values())).rejects.toMatchObject({
        code: 'not_staff',
      });
      await expect(
        confirmBlockedTime(database.db, clock, staffId, values(), randomUUID(), '0'.repeat(64)),
      ).rejects.toMatchObject({ code: 'not_staff' });
      await expect(listBlockedTime(database.db, staffId)).rejects.toMatchObject({ code: 'not_staff' });
      await expect(listBlockCancellations(database.db, staffId, randomUUID())).rejects.toMatchObject({
        code: 'not_staff',
      });
    }
    await expect(
      reviewBlockedTime(database.db, clock, clinic.admin.id, {
        ...values(),
        practitionerId: foreignClinic.practitioners.weekdays,
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await confirm();
    expect(await listBlockedTime(foreign.db, foreignClinic.admin.id)).toHaveLength(0);
  });

  it('rejects invalid ranges without changing existing bookings', async () => {
    for (const input of [
      { ...values(), end: values().start },
      { ...values(), start: '2026-10-19T09:00' },
      { ...values(), start: '2026-10-20T08:00' },
      { ...values(), start: '2026-10-25T01:30' },
    ]) {
      await expect(reviewBlockedTime(database.db, clock, clinic.admin.id, input)).rejects.toMatchObject({
        code: 'invalid',
      });
    }
    expect(await database.db.select().from(blockedPeriods)).toHaveLength(0);
  });

  it('keeps adjacent times available and blocks only the selected practitioner', async () => {
    const target = await targetSlot();
    await confirm({ ...values(), start: '2026-10-22T09:45', end: '2026-10-22T10:30' });
    expect(await isSlotFree(database.db, target.id)).toBe(true);
    const other = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.saturdays,
      after: new Date('2026-10-22T07:00:00Z'),
      until: new Date('2026-10-22T17:00:00Z'),
    });
    expect(other.length).toBeGreaterThan(0);
  });

  it('serialises a block with concurrent bookings and moves, retaining a failed move at its original time', async () => {
    const target = await targetSlot();
    const free = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.weekdays,
      after: new Date('2026-10-23T07:00:00Z'),
      until: new Date('2026-10-23T18:00:00Z'),
    });
    const original = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: free[0]!.id });
    const checked = await reviewBlockedTime(database.db, clock, clinic.admin.id, values());
    // Hold the diary lock until all competing operations are queued.
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { lockDiary } = await import('@/server/bookings/diary-lock');
    const holder = database.db.transaction(async (tx) => {
      await lockDiary(tx);
      ready();
      await gate;
    });
    await held;
    const block = confirmBlockedTime(database.db, clock, clinic.admin.id, values(), randomUUID(), checked.snapshot);
    const move = rescheduleBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: original.id,
      newSlotId: target.id,
    });
    const book = bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target.id });
    // Either the reviewed block saves first, or changed impact requires another review.
    release();
    await holder;
    const results = await Promise.allSettled([block, move, book]);
    const saved = results[0]!.status === 'fulfilled';
    if (saved) {
      expect(results.slice(1)).toMatchObject([
        { status: 'rejected', reason: { code: 'slot_blocked' } },
        { status: 'rejected', reason: { code: 'slot_blocked' } },
      ]);
      expect((await findBookingForPatient(database.db, clinic.patient1.id, original.id))?.slotId).toBe(original.slotId);
    } else {
      expect(results[0]).toMatchObject({ status: 'rejected', reason: { code: 'changed' } });
      await confirm();
    }
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(and(eq(bookings.slotId, target.id), eq(bookings.status, 'confirmed'))),
    ).toHaveLength(0);
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    await expect(bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target.id })).rejects.toMatchObject({
      code: 'slot_blocked',
    });
  });
});

it('upgrades a populated previous database without changing its bookings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bookit-block-upgrade-'));
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('bookit_upgrade').start();
  const url = container.getConnectionUri();
  const handle = createDatabase(url);
  try {
    await mkdir(path.join(directory, 'meta'));
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.slice(0, 2);
    await writeFile(path.join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      await copyFile(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(directory, `${entry.tag}.sql`));
    await migrate(handle.db, { migrationsFolder: directory });
    const previous = await seedClinic(handle.db, clock, { settings: { slotHorizonDays: 7 } });
    const [slot] = await handle.db.select().from(slots);
    await handle.db.insert(bookings).values({
      id: randomUUID(),
      patientId: previous.patient1.id,
      slotId: slot!.id,
      status: 'confirmed',
      lateCancellation: false,
      phone: null,
      rescheduleCount: 0,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      cancelledAt: null,
    });
    const before = await handle.db.select().from(bookings);
    await runMigrations(url);
    expect(await handle.db.select().from(bookings)).toEqual(before);
    expect(await handle.db.select().from(blockedPeriods)).toHaveLength(0);
    expect(await handle.db.select().from(blockedCancellations)).toHaveLength(0);
    const checked = await reviewBlockedTime(handle.db, clock, previous.admin.id, {
      ...values(),
      practitionerId: previous.practitioners.weekdays,
    });
    await confirmBlockedTime(handle.db, clock, previous.admin.id, checked.values, randomUUID(), checked.snapshot);
    expect(await listBlockedTime(handle.db, previous.admin.id)).toHaveLength(1);
  } finally {
    await handle.pool.end();
    await container.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
