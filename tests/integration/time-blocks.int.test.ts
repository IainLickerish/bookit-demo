import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, timeBlocks, users } from '@/db/schema';
import { createTimeBlock, listTimeBlocks } from '@/server/admin/time-blocks';
import { createSession } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { ensureSlotsThroughHorizon } from '@/server/slots/ensure';
import { isSlotFree, listAvailableSlots } from '@/server/slots/queries';
import { runMigrations } from '@/db/migrate';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let other: TestDatabase;
let clinic: SeededClinic;
let token: string;
const clock = manualClock('2026-10-20T07:00:00Z');
const logs = captureLogs(clock);
const input = (practitionerId: string, start = '2026-10-22T09:30', end = '2026-10-22T10:00') => ({
  practitionerId,
  start,
  end,
  reason: 'Training',
});
const deps = () => ({ db: database.db, clock, log: logs.log, mail: testMail() });
const available = (practitionerId = clinic.practitioners.weekdays) =>
  listAvailableSlots(database.db, {
    practitionerId,
    after: clock.now(),
    until: new Date('2026-10-24T00:00:00Z'),
  });
async function slot(time: string) {
  const found = (await available()).find((row) => row.startsAt.toISOString() === `2026-10-22T${time}:00.000Z`);
  if (!found) throw new Error('Fixture slot missing');
  return found;
}
beforeAll(async () => {
  database = await startTestDatabase();
  other = await startTestDatabase();
});
afterAll(async () => {
  await Promise.all([database?.stop(), other?.stop()]);
});
beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 7 } });
  token = (await createSession(database.db, clock, clinic.admin.id)).token;
});

describe('staff time blocks', () => {
  it('saves clinic-local times and optional reasons, refusing invalid input without writes', async () => {
    const id = await createTimeBlock(deps(), token, { ...input(clinic.practitioners.weekdays), reason: '  ' });
    expect(await listTimeBlocks(deps(), token)).toMatchObject([
      { id, startsAt: new Date('2026-10-22T08:30:00Z'), endsAt: new Date('2026-10-22T09:00:00Z'), reason: null },
    ]);
    for (const [values, code] of [
      [{ practitionerId: randomUUID() }, 'practitioner'],
      [{ practitionerId: 'bad' }, 'practitioner'],
      [{ start: '2026-02-30T10:00' }, 'start'],
      [{ end: '' }, 'end'],
      [{ start: '2026-10-22T10:00' }, 'range'],
      [{ end: '2026-10-22T09:00' }, 'range'],
      [{ reason: 'x'.repeat(501) }, 'reason'],
    ] as const) {
      await expect(
        createTimeBlock(deps(), token, { ...input(clinic.practitioners.weekdays), ...values }),
      ).rejects.toMatchObject({ code });
    }
    expect(await listTimeBlocks(deps(), token)).toHaveLength(1);
  });

  it('hides every overlapping slot but allows touching boundaries and other practitioners, including future generated slots', async () => {
    const before = await available();
    const otherBefore = await available(clinic.practitioners.saturdays);
    await createTimeBlock(deps(), token, input(clinic.practitioners.weekdays, '2026-10-22T09:45', '2026-10-22T10:31'));
    const after = await available();
    const removed = before.filter((row) => !after.some((free) => row.id === free.id));
    expect(removed.map((row) => row.startsAt.toISOString())).toEqual([
      '2026-10-22T08:45:00.000Z',
      '2026-10-22T09:30:00.000Z',
    ]);
    expect(after.some((row) => row.startsAt.toISOString() === '2026-10-22T08:00:00.000Z')).toBe(true);
    expect(after.some((row) => row.startsAt.toISOString() === '2026-10-22T10:15:00.000Z')).toBe(true);
    expect(await available(clinic.practitioners.saturdays)).toEqual(otherBefore);
    for (const row of removed) expect(await isSlotFree(database.db, row.id)).toBe(false);
    await createTimeBlock(deps(), token, input(clinic.practitioners.weekdays, '2026-11-02T00:00', '2026-11-03T00:00'));
    await database.db.execute(sql`update clinic_settings set slot_horizon_days = 20`);
    await ensureSlotsThroughHorizon(database.db, clock);
    expect(
      await listAvailableSlots(database.db, {
        practitionerId: clinic.practitioners.weekdays,
        after: new Date('2026-11-01T23:59:00Z'),
        until: new Date('2026-11-02T23:59:00Z'),
      }),
    ).toEqual([]);
  });

  it('lists only affected confirmed bookings with contact details and preserves every stored booking field', async () => {
    const first = await bookSlot(deps(), {
      patientId: clinic.patient1.id,
      slotId: (await slot('08:00')).id,
      phone: '+44 7700 900001',
    });
    const cancelled = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: (await slot('08:45')).id });
    await cancelBooking(deps(), { patientId: clinic.patient2.id, bookingId: cancelled.id });
    const untouched = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: (await slot('09:30')).id });
    const before = await database.db.select().from(bookings).orderBy(bookings.id);
    await createTimeBlock(deps(), token, input(clinic.practitioners.weekdays, '2026-10-22T09:30', '2026-10-22T10:30'));
    const [block] = await listTimeBlocks(deps(), token);
    expect(block!.affectedBookings).toMatchObject([
      {
        id: first.id,
        patientName: clinic.patient1.name,
        email: clinic.patient1.email,
        phone: '+44 7700 900001',
        practitionerName: 'Pat Physio',
        startsAt: first.startsAt,
        endsAt: first.endsAt,
      },
    ]);
    expect(block!.affectedBookings.map((row) => row.id)).not.toContain(untouched.id);
    expect(await database.db.select().from(bookings).orderBy(bookings.id)).toEqual(before);
    await runMigrations(database.url);
    expect(await database.db.select().from(bookings).orderBy(bookings.id)).toEqual(before);
    expect(await database.db.select().from(timeBlocks)).toHaveLength(1);
  });

  it('applies the new migration to an existing diary without changing its bookings', async () => {
    const saved = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await slot('08:00')).id });
    const before = await database.db.select().from(bookings);
    // Recreate the previous version's schema and migration history in this disposable database.
    await database.db.execute(sql`drop table time_block`);
    await database.db.execute(
      sql`delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`,
    );
    await runMigrations(database.url);
    expect(await database.db.select().from(bookings)).toEqual(before);
    await createTimeBlock(deps(), token, input(clinic.practitioners.weekdays));
    expect((await listTimeBlocks(deps(), token))[0]!.affectedBookings.map((row) => row.id)).toEqual([saved.id]);
  });

  it('refuses stale booking and move submissions and keeps the original booking; outside time still books, moves and cancels', async () => {
    const blocked = await slot('08:45');
    const original = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await slot('08:00')).id });
    await createTimeBlock(deps(), token, input(clinic.practitioners.weekdays));
    await expect(bookSlot(deps(), { patientId: clinic.patient2.id, slotId: blocked.id })).rejects.toMatchObject({
      code: 'slot_blocked',
    });
    await expect(
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: original.id, newSlotId: blocked.id }),
    ).rejects.toMatchObject({ code: 'slot_blocked' });
    expect((await database.db.select().from(bookings).where(eq(bookings.id, original.id)))[0]).toMatchObject({
      slotId: original.slotId,
      rescheduleCount: 0,
      status: 'confirmed',
    });
    const moved = await rescheduleBooking(deps(), {
      patientId: clinic.patient1.id,
      bookingId: original.id,
      newSlotId: (await slot('10:15')).id,
    });
    expect(moved.status).toBe('confirmed');
    await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: original.id });
    expect(await isSlotFree(database.db, moved.slotId)).toBe(true);
  });

  it('serialises a block racing with booking or moving: the booking is refused or appears in the warning', async () => {
    for (const move of [false, true]) {
      const target = await slot(move ? '10:15' : '08:00');
      const original = move
        ? await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: (await slot('11:00')).id })
        : null;
      const booking = move
        ? rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: original!.id, newSlotId: target.id })
        : bookSlot(deps(), { patientId: clinic.patient1.id, slotId: target.id });
      const [result, block] = await Promise.allSettled([
        booking,
        createTimeBlock(
          deps(),
          token,
          input(
            clinic.practitioners.weekdays,
            move ? '2026-10-22T11:15' : '2026-10-22T09:00',
            move ? '2026-10-22T12:00' : '2026-10-22T09:45',
          ),
        ),
      ]);
      expect(block.status).toBe('fulfilled');
      const warnings = (await listTimeBlocks(deps(), token)).flatMap((row) => row.affectedBookings);
      if (result.status === 'fulfilled') expect(warnings.map((row) => row.id)).toContain(result.value.id);
      else expect(result.reason).toMatchObject({ code: 'slot_blocked' });
      expect(await isSlotFree(database.db, target.id)).toBe(false);
    }
  });

  it('refuses absent, forged, expired, patient, former staff and another clinic’s sessions for reads and writes', async () => {
    await createTimeBlock(deps(), token, input(clinic.practitioners.weekdays));
    const patient = (await createSession(database.db, clock, clinic.patient1.id)).token;
    const expired = (await createSession(database.db, manualClock('2026-10-01T07:00:00Z'), clinic.admin.id)).token;
    for (const bad of [undefined, 'forged', patient, expired]) {
      await expect(createTimeBlock(deps(), bad, input(clinic.practitioners.weekdays))).rejects.toThrow(
        'Staff sign-in required',
      );
      await expect(listTimeBlocks(deps(), bad)).rejects.toThrow('Staff sign-in required');
    }
    await expect(listTimeBlocks({ ...deps(), db: other.db }, token)).rejects.toThrow('Staff sign-in required');
    await expect(
      createTimeBlock({ ...deps(), db: other.db }, token, input(clinic.practitioners.weekdays)),
    ).rejects.toThrow('Staff sign-in required');
    await database.db.update(users).set({ role: 'patient' }).where(eq(users.id, clinic.admin.id));
    await expect(listTimeBlocks(deps(), token)).rejects.toThrow('Staff sign-in required');
    await expect(createTimeBlock(deps(), token, input(clinic.practitioners.weekdays))).rejects.toThrow(
      'Staff sign-in required',
    );
    expect(await database.db.select().from(timeBlocks)).toHaveLength(1);
    expect(JSON.stringify(logs.lines)).not.toContain('Training');
  });
});
