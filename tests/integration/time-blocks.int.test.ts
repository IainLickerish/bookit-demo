import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { MIGRATIONS_FOLDER, runMigrations } from '@/db/migrate';
import { bookings, practitioners, timeBlocks } from '@/db/schema';
import { saveTimeBlock, listTimeBlocks } from '@/server/admin/time-blocks';
import { bookSlot } from '@/server/bookings/book';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { findBookingForPatient } from '@/server/bookings/queries';
import { findBookableSlot, isSlotFree, listAvailableSlots, type SlotView } from '@/server/slots/queries';
import { lockPractitioner } from '@/server/practitioners';
import { formatLocalTime, localDateOf } from '@/lib/time';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');
const deps = () => ({ db: database.db, clock, log: captureLogs(clock).log, mail: testMail() });
const block = (start: string, end: string, reason = '') =>
  saveTimeBlock(database.db, clock, {
    practitionerId: clinic.practitioners.weekdays,
    start,
    end,
    reason,
  });
const available = () =>
  listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: new Date('2027-05-01T00:00:00Z'),
  });
async function at(time: string, date = '2026-10-22'): Promise<SlotView> {
  const slot = (await available()).find(
    (slot) =>
      localDateOf(slot.startsAt, 'Europe/London') === date && formatLocalTime(slot.startsAt, 'Europe/London') === time,
  );
  if (!slot) throw new Error(`Expected free slot ${date} ${time}`);
  return slot;
}

beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
});

describe('blocked practitioner time', () => {
  it('hides any overlap, leaves touching endpoints and other practitioners free, and refuses forged bookings and moves', async () => {
    const before = await at('09:00');
    const target = await at('09:45');
    const after = await at('10:30');
    const original = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await at('11:15')).id });
    // Upgrade case: save an additive block after an existing booking.
    await block('2026-10-22T09:45', '2026-10-22T10:30', 'Staff training');
    expect(await isSlotFree(database.db, before.id)).toBe(true);
    expect(await isSlotFree(database.db, after.id)).toBe(true);
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    expect((await available()).map((slot) => slot.id)).not.toContain(target.id);
    expect(await findBookableSlot(database.db, target.id)).not.toBeNull();
    await expect(bookSlot(deps(), { patientId: clinic.patient2.id, slotId: target.id })).rejects.toMatchObject({
      code: 'slot_blocked',
    });
    await expect(
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: original.id, newSlotId: target.id }),
    ).rejects.toMatchObject({ code: 'slot_blocked' });
    expect(await findBookingForPatient(database.db, clinic.patient1.id, original.id)).toEqual(original);
    const other = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.saturdays,
      after: clock.now(),
      until: new Date('2026-10-23T00:00:00Z'),
    });
    expect(
      other.some(
        (slot) =>
          localDateOf(slot.startsAt, 'Europe/London') === '2026-10-22' &&
          formatLocalTime(slot.startsAt, 'Europe/London') === '10:00',
      ),
    ).toBe(true);
    // A block inside a slot must hide the whole slot.
    await block('2026-10-22T10:40', '2026-10-22T10:41');
    expect(await isSlotFree(database.db, after.id)).toBe(false);
  });

  it('lists every confirmed overlapping booking and preserves all stored booking fields', async () => {
    const first = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await at('09:00')).id });
    const second = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: (await at('09:45')).id });
    const before = await database.db.select().from(bookings);
    const id = await block('2026-10-22T09:30', '2026-10-22T10:00', 'Holiday');
    const saved = (await listTimeBlocks(database.db)).find((row) => row.id === id)!;
    expect(saved.affected.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(saved.reason).toBe('Holiday');
    expect(await database.db.select().from(bookings)).toEqual(before);
    const empty = await block('2026-10-22T12:00', '2026-10-22T13:00');
    expect((await listTimeBlocks(database.db)).find((row) => row.id === empty)?.affected).toEqual([]);
    // A later cancellation is no longer a conflict; a block never alters it.
    await database.db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: clock.now() })
      .where(eq(bookings.id, first.id));
    expect((await listTimeBlocks(database.db)).find((row) => row.id === id)?.affected.map((row) => row.id)).toEqual([
      second.id,
    ]);
  });

  it('refuses invalid input and practitioners outside this database without saving anything', async () => {
    await expect(block('2026-10-22T10:00', '2026-10-22T09:00')).rejects.toMatchObject({ fields: { end: 'end_order' } });
    await expect(
      saveTimeBlock(database.db, clock, {
        practitionerId: '019a0000-0000-7000-8000-000000000001',
        start: '2026-10-22T09:00',
        end: '2026-10-22T10:00',
        reason: 'Away',
      }),
    ).rejects.toMatchObject({ fields: { practitionerId: 'practitioner' } });
    expect(await database.db.select().from(timeBlocks)).toEqual([]);
  });

  it.each(['book', 'move'] as const)('refuses a concurrent %s when the block commits first', async (operation) => {
    const target = await at('09:45');
    const original =
      operation === 'move'
        ? await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await at('11:15')).id })
        : undefined;
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let release!: () => void;
    const canCommit = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = database.db.transaction(async (tx) => {
      await lockPractitioner(tx, target.practitionerId);
      await tx.insert(timeBlocks).values({
        id: '019a0000-0000-7000-8000-000000000002',
        practitionerId: target.practitionerId,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
        reason: null,
        createdAt: clock.now(),
      });
      locked();
      await canCommit;
    });
    await hasLock;
    const attempt =
      operation === 'move'
        ? rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: original!.id, newSlotId: target.id })
        : bookSlot(deps(), { patientId: clinic.patient1.id, slotId: target.id });
    const outcome = attempt.then(
      () => 'confirmed',
      (error: unknown) => error,
    );
    try {
      await vi.waitFor(
        async () => {
          const waiting = await database.handle.pool.query<{ count: string }>(
            "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          expect(Number(waiting.rows[0]!.count)).toBeGreaterThan(0);
        },
        { timeout: 5_000 },
      );
    } finally {
      release();
      await save;
    }
    expect(await outcome).toMatchObject({ code: 'slot_blocked' });
    if (original) expect(await findBookingForPatient(database.db, clinic.patient1.id, original.id)).toEqual(original);
  });

  it('keeps a booking that wins the lock and includes it in the block warning', async () => {
    const target = await at('09:45');
    const connection = await database.handle.pool.connect();
    try {
      await connection.query('begin');
      await connection.query('select id from practitioner where id = $1 for update', [target.practitionerId]);
      // The raw write represents the part of bookSlot under its practitioner lock.
      await connection.query(
        `insert into booking (id, patient_id, slot_id, status, late_cancellation, reschedule_count, created_at, updated_at)
        values ($1,$2,$3,'confirmed',false,0,$4,$4)`,
        ['019a0000-0000-7000-8000-000000000003', clinic.patient1.id, target.id, clock.now()],
      );
      const saving = block('2026-10-22T09:45', '2026-10-22T10:30');
      await connection.query('commit');
      const id = await saving;
      expect((await listTimeBlocks(database.db)).find((row) => row.id === id)?.affected).toMatchObject([
        { patientName: clinic.patient1.name },
      ]);
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('stores exact instants across both UK clock changes and blocks slots on both sides', async () => {
    await database.db
      .update(practitioners)
      .set({ workingDays: [1, 2, 3, 4, 5, 6, 7] })
      .where(eq(practitioners.id, clinic.practitioners.weekdays));
    await block('2026-10-23T09:00', '2026-10-26T09:45');
    await block('2027-03-26T09:00', '2027-03-29T09:45');
    const saved = await listTimeBlocks(database.db);
    expect(saved.map((row) => [row.startsAt.toISOString(), row.endsAt.toISOString()])).toEqual([
      ['2026-10-23T08:00:00.000Z', '2026-10-26T09:45:00.000Z'],
      ['2027-03-26T09:00:00.000Z', '2027-03-29T08:45:00.000Z'],
    ]);
    const free = await available();
    for (const date of ['2026-10-23', '2026-10-26', '2027-03-26', '2027-03-29']) {
      expect(
        free
          .filter((slot) => localDateOf(slot.startsAt, 'Europe/London') === date)
          .map((slot) => formatLocalTime(slot.startsAt, 'Europe/London')),
      ).not.toContain('09:00');
    }
  });

  it('upgrades the previous schema with bookings intact and rehearses reversible removal of a mistaken block', async () => {
    const existing = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await at('09:00')).id });
    const target = await at('09:45');
    const before = await database.db.select().from(bookings);
    // Reconstruct the previous schema only inside this disposable test database.
    const addedMigration = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).at(-1)!;
    await database.handle.pool.query('drop table time_block');
    await database.handle.pool.query('delete from drizzle.__drizzle_migrations where hash = $1', [addedMigration.hash]);
    await runMigrations(database.url);
    expect(await database.db.select().from(bookings)).toEqual(before);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, existing.id)).toEqual(existing);
    const id = await block('2026-10-22T09:45', '2026-10-22T10:30', 'Mistaken block');
    const [copy] = await database.db.select().from(timeBlocks).where(eq(timeBlocks.id, id));
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    await database.db.delete(timeBlocks).where(eq(timeBlocks.id, id));
    expect(await isSlotFree(database.db, target.id)).toBe(true);
    await database.db.insert(timeBlocks).values(copy!);
    expect(await isSlotFree(database.db, target.id)).toBe(false);
    expect(await database.db.select().from(bookings)).toEqual(before);
  });
});
