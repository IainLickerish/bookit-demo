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
  BLOCKED_TIME_PAGE_SIZE,
  confirmBlockedTime,
  getBlockedTime,
  listBlockCancellations,
  listBlockedTime,
  reviewBlockedTime,
} from '@/server/admin/blocked-time';
import { bookSlot } from '@/server/bookings/book';
import { lockDiary } from '@/server/bookings/diary-lock';
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

/** Queue each real transaction in PostgreSQL, in a known order, before opening the gate. */
async function queuedDiaryRace(jobs: (() => Promise<unknown>)[]) {
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = database.db.transaction(async (tx) => {
    await lockDiary(tx);
    ready();
    await gate;
  });
  const pending: Promise<PromiseSettledResult<unknown>>[] = [];
  try {
    await Promise.race([held, holder]);
    for (const [index, job] of jobs.entries()) {
      // Attach a rejection handler immediately, including during barrier failure cleanup.
      pending.push(
        job().then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        ),
      );
      await expect
        .poll(
          async () => {
            const result = await database.db.execute(sql`
          select count(*)::int as waiting from pg_locks
          where locktype = 'advisory' and classid = 0 and objid = 781204
            and objsubid = 1 and not granted
            and database = (select oid from pg_database where datname = current_database())
        `);
            return result.rows[0]!.waiting;
          },
          { timeout: 10_000 },
        )
        .toBe(index + 1);
    }
  } finally {
    release();
    await holder;
    await Promise.all(pending);
  }
  return Promise.all(pending);
}

async function expectNoConfirmedOverlap() {
  const overlapping = await database.db
    .select({ bookingId: bookings.id, blockId: blockedPeriods.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(
      blockedPeriods,
      and(
        eq(blockedPeriods.practitionerId, slots.practitionerId),
        sql`${slots.startsAt} < ${blockedPeriods.endsAt}`,
        sql`${slots.endsAt} > ${blockedPeriods.startsAt}`,
      ),
    )
    .where(eq(bookings.status, 'confirmed'));
  expect(overlapping).toEqual([]);
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
    expect((await listBlockedTime(database.db, clinic.admin.id)).blocks).toHaveLength(1);
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
      await expect(getBlockedTime(database.db, staffId, randomUUID())).rejects.toMatchObject({ code: 'not_staff' });
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
    expect((await listBlockedTime(foreign.db, foreignClinic.admin.id)).blocks).toHaveLength(0);
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

  it('pages through tied creation times without gaps and directly reopens an older block with its cancellations', async () => {
    const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await targetSlot()).id });
    const older = await confirm();
    const newerIds = Array.from({ length: BLOCKED_TIME_PAGE_SIZE * 2 }, () => randomUUID());
    await database.db.insert(blockedPeriods).values(
      newerIds.map((id) => ({
        id,
        practitionerId: clinic.practitioners.weekdays,
        startsAt: older.checked.startsAt,
        endsAt: older.checked.endsAt,
        createdAt: new Date(clock.now().getTime() + 1),
        createdBy: clinic.admin.id,
        reason: 'Later saved block',
      })),
    );
    const first = await listBlockedTime(database.db, clinic.admin.id);
    expect(first.blocks).toHaveLength(BLOCKED_TIME_PAGE_SIZE);
    expect(first.blocks.map((block) => block.id)).not.toContain(older.id);
    expect(await getBlockedTime(database.db, clinic.admin.id, older.id)).toMatchObject({
      id: older.id,
      reason: 'Training',
    });
    expect(await listBlockCancellations(database.db, clinic.admin.id, older.id)).toMatchObject([{ id: booking.id }]);
    const second = await listBlockedTime(database.db, clinic.admin.id, first.nextCursor!);
    const last = await listBlockedTime(database.db, clinic.admin.id, second.nextCursor!);
    expect(second.blocks).toHaveLength(BLOCKED_TIME_PAGE_SIZE);
    expect(last.blocks.map((block) => block.id)).toEqual([older.id]);
    expect(last.nextCursor).toBeNull();
    const allIds = [...first.blocks, ...second.blocks, ...last.blocks].map((block) => block.id);
    expect(new Set(allIds).size).toBe(newerIds.length + 1);
    expect(allIds.slice(0, -1)).toEqual(newerIds.sort().reverse());
    for (const invalid of ['not-an-id', randomUUID()]) {
      expect(await getBlockedTime(database.db, clinic.admin.id, invalid)).toBeNull();
      expect(await listBlockedTime(database.db, clinic.admin.id, invalid)).toEqual(first);
    }
    expect(await getBlockedTime(foreign.db, foreignClinic.admin.id, older.id)).toBeNull();
  });

  const operations = ['block A', 'block B', 'book', 'move'] as const;
  type Operation = (typeof operations)[number];
  function permutations(items: readonly Operation[]): Operation[][] {
    return items.length
      ? items.flatMap((item) => permutations(items.filter((other) => other !== item)).map((rest) => [item, ...rest]))
      : [[]];
  }

  it.each(permutations(operations).map((order) => [order.join(', '), order] as const))(
    'serialises two overlapping blocks, a booking and a move in queued save order: %s',
    async (_name, order) => {
      const targets = await listAvailableSlots(database.db, {
        practitionerId: clinic.practitioners.weekdays,
        after: new Date('2026-10-22T07:00:00Z'),
        until: new Date('2026-10-22T12:00:00Z'),
      });
      const originals = await listAvailableSlots(database.db, {
        practitionerId: clinic.practitioners.weekdays,
        after: new Date('2026-10-23T07:00:00Z'),
        until: new Date('2026-10-23T18:00:00Z'),
      });
      const original = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: originals[0]!.id });
      const affected = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: targets[2]!.id });
      const inputs = {
        'block A': { ...values(), start: '2026-10-22T09:00', end: '2026-10-22T12:00' },
        'block B': { ...values(), start: '2026-10-22T09:10', end: '2026-10-22T12:10' },
      };
      const ids = { 'block A': randomUUID(), 'block B': randomUUID() };
      const reviews = {
        'block A': await reviewBlockedTime(database.db, clock, clinic.admin.id, inputs['block A']),
        'block B': await reviewBlockedTime(database.db, clock, clinic.admin.id, inputs['block B']),
      };
      const jobs = {
        'block A': () =>
          confirmBlockedTime(
            database.db,
            clock,
            clinic.admin.id,
            inputs['block A'],
            ids['block A'],
            reviews['block A'].snapshot,
          ),
        'block B': () =>
          confirmBlockedTime(
            database.db,
            clock,
            clinic.admin.id,
            inputs['block B'],
            ids['block B'],
            reviews['block B'].snapshot,
          ),
        book: () => bookSlot(deps(), { patientId: clinic.patient2.id, slotId: targets[0]!.id }),
        move: () =>
          rescheduleBooking(deps(), {
            patientId: clinic.patient1.id,
            bookingId: original.id,
            newSlotId: targets[1]!.id,
          }),
      };
      const results = await queuedDiaryRace(order.map((name) => jobs[name]));
      const blockFirst = order[0] === 'block A' || order[0] === 'block B';
      const savedId = blockFirst ? ids[order[0] as 'block A' | 'block B'] : null;
      for (const [index, name] of order.entries()) {
        const result = results[index]!;
        if (name === 'block A' || name === 'block B') {
          expect(result).toMatchObject(
            ids[name] === savedId
              ? { status: 'fulfilled', value: savedId }
              : { status: 'rejected', reason: { code: 'changed' } },
          );
        } else {
          expect(result).toMatchObject(
            blockFirst ? { status: 'rejected', reason: { code: 'slot_blocked' } } : { status: 'fulfilled' },
          );
        }
      }
      // Inspect the persisted race result before any new review or confirmation.
      expect((await database.db.select().from(blockedPeriods)).map((block) => block.id)).toEqual(
        savedId ? [savedId] : [],
      );
      expect(await database.db.select().from(blockedCancellations)).toEqual(
        savedId ? [{ blockId: savedId, bookingId: affected.id }] : [],
      );
      expect(await findBookingForPatient(database.db, clinic.patient2.id, affected.id)).toMatchObject({
        status: blockFirst ? 'cancelled' : 'confirmed',
        cancelledAt: blockFirst ? clock.now() : null,
      });
      expect(await findBookingForPatient(database.db, clinic.patient1.id, original.id)).toMatchObject({
        status: 'confirmed',
        slotId: blockFirst ? original.slotId : targets[1]!.id,
        rescheduleCount: blockFirst ? 0 : 1,
      });
      const persisted = await database.db.select().from(bookings);
      expect(persisted.filter((booking) => booking.slotId === targets[0]!.id)).toHaveLength(blockFirst ? 0 : 1);
      await expectNoConfirmedOverlap();
    },
  );

  it.each([false, true])(
    'preserves each cancellation history when both overlapping blocks save, reverse order: %s',
    async (reverse) => {
      const targets = await listAvailableSlots(database.db, {
        practitionerId: clinic.practitioners.weekdays,
        after: new Date('2026-10-22T07:00:00Z'),
        until: new Date('2026-10-22T12:00:00Z'),
      });
      const affected = [
        await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: targets[0]!.id }),
        await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: targets[2]!.id }),
      ];
      const inputs = [
        { ...values(), start: '2026-10-22T09:00', end: '2026-10-22T10:00' },
        { ...values(), start: '2026-10-22T09:45', end: '2026-10-22T11:00' },
      ];
      const ids = [randomUUID(), randomUUID()];
      const reviews = await Promise.all(
        inputs.map((input) => reviewBlockedTime(database.db, clock, clinic.admin.id, input)),
      );
      const jobs = inputs.map(
        (input, index) => () =>
          confirmBlockedTime(database.db, clock, clinic.admin.id, input, ids[index]!, reviews[index]!.snapshot),
      );
      if (reverse) jobs.reverse();
      expect(await queuedDiaryRace(jobs)).toEqual(
        jobs.map((_, index) => ({ status: 'fulfilled', value: ids[reverse ? 1 - index : index] })),
      );
      expect(await database.db.select().from(blockedPeriods)).toHaveLength(2);
      expect(await database.db.select().from(blockedCancellations)).toEqual(
        expect.arrayContaining(ids.map((blockId, index) => ({ blockId, bookingId: affected[index]!.id }))),
      );
      expect(await database.db.select().from(blockedCancellations)).toHaveLength(2);
      expect(await database.db.select().from(bookings).where(eq(bookings.status, 'confirmed'))).toHaveLength(0);
      for (const [index, id] of ids.entries()) {
        expect(await listBlockCancellations(database.db, clinic.admin.id, id)).toMatchObject([
          { id: affected[index]!.id },
        ]);
      }
      await expectNoConfirmedOverlap();
    },
  );
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
    expect((await listBlockedTime(handle.db, previous.admin.id)).blocks).toHaveLength(1);
  } finally {
    await handle.pool.end();
    await container.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
