import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings } from '@/db/schema';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { BookingError } from '@/server/bookings/errors';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { postgresErrorOf } from '@/server/errors';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';

const EVIDENCE_DIR = path.resolve(import.meta.dirname, '../../test-results/m0-24a');

function recordEvidence(name: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(data)}`);
}

let database: TestDatabase;
let clinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');

async function freeSlotIds(count: number): Promise<string[]> {
  const slots = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: new Date('2026-12-31T00:00:00Z'),
  });
  return slots.slice(10, 10 + count).map((s) => s.id);
}

async function confirmedCount(slotId: string): Promise<number> {
  const rows = await database.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.slotId, slotId), eq(bookings.status, 'confirmed')));
  return rows.length;
}

beforeAll(async () => {
  database = await startTestDatabase(30);
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { extraPatients: 20 });
});

describe('one confirmed booking per slot under concurrency (REQ-18.1-01)', () => {
  it('the database constraint lets only one of two parallel transactions confirm the same slot', async () => {
    const [slotId] = await freeSlotIds(1);
    const [first, second] = [new Client(database.url), new Client(database.url)];
    await Promise.all([first.connect(), second.connect()]);
    const insert = (client: Client, id: string, patientId: string) =>
      client.query(
        `insert into "booking" (id, patient_id, slot_id, status, late_cancellation, phone, reschedule_count, created_at, updated_at)
         values ($1, $2, $3, 'confirmed', false, null, 0, $4, $4)`,
        [id, patientId, slotId, clock.now()],
      );
    try {
      await first.query('begin');
      await second.query('begin');
      await insert(first, '019a0000-0000-7000-8000-000000000001', clinic.patient1.id);
      // The second insert waits on the first transaction's uncommitted row.
      const secondInsert = insert(second, '019a0000-0000-7000-8000-000000000002', clinic.patient2.id).then(
        () => 'inserted',
        (error: unknown) => postgresErrorOf(error),
      );
      await first.query('commit');
      const outcome = await secondInsert;
      await second.query('rollback');
      expect(outcome).toEqual({ code: '23505', constraint: 'booking_one_confirmed_per_slot' });
      expect(await confirmedCount(slotId!)).toBe(1);
      recordEvidence('constraint-parallel-transactions', {
        slotId,
        firstTransaction: 'committed',
        secondTransaction: outcome,
        confirmedBookingsForSlot: 1,
      });
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('twenty patients booking the same slot at once: exactly one succeeds', async () => {
    const [slotId] = await freeSlotIds(1);
    const logs = captureLogs(clock);
    const results = await Promise.allSettled(
      clinic.extraPatientIds.map((patientId) =>
        bookSlot({ db: database.db, clock, log: logs.log }, { patientId, slotId: slotId! }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const refusals = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason instanceof BookingError ? r.reason.code : String(r.reason)] : [],
    );
    expect(succeeded).toHaveLength(1);
    expect(refusals).toEqual(Array(19).fill('slot_unavailable'));
    expect(await confirmedCount(slotId!)).toBe(1);
    expect(logs.events().filter((e) => e === 'booking.confirmed')).toHaveLength(1);
    recordEvidence('concurrent-book-same-slot', {
      slotId,
      attempts: results.length,
      succeeded: succeeded.length,
      refusals: refusals.length,
      refusalCodes: [...new Set(refusals)],
      confirmedBookingsForSlot: 1,
    });
  });

  it('two bookings rescheduled into the same free slot at once: exactly one moves', async () => {
    const [slotA, slotB, target] = await freeSlotIds(3);
    const deps = { db: database.db, clock, log: captureLogs(clock).log };
    const a = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slotA! });
    const b = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: slotB! });
    const results = await Promise.allSettled([
      rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: a.id, newSlotId: target! }),
      rescheduleBooking(deps, { patientId: clinic.patient2.id, bookingId: b.id, newSlotId: target! }),
    ]);
    const outcomes = results.map((r) =>
      r.status === 'fulfilled' ? 'moved' : r.reason instanceof BookingError ? r.reason.code : 'error',
    );
    expect(outcomes.sort()).toEqual(['moved', 'slot_unavailable']);
    expect(await confirmedCount(target!)).toBe(1);
    recordEvidence('concurrent-reschedule-same-slot', { target, outcomes });
  });

  it('a cancelled booking frees its slot for another patient', async () => {
    const [slotId] = await freeSlotIds(1);
    const deps = { db: database.db, clock, log: captureLogs(clock).log };
    const first = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slotId! });
    await expect(bookSlot(deps, { patientId: clinic.patient2.id, slotId: slotId! })).rejects.toMatchObject({
      code: 'slot_unavailable',
    });
    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: first.id });
    const second = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: slotId! });
    expect(second.status).toBe('confirmed');
    expect(await confirmedCount(slotId!)).toBe(1);
  });
});
