import { asc, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { bookings, timeBlocks } from '@/db/schema';
import { newId } from '@/lib/ids';
import { updateAdminSettings } from '@/server/admin/settings';
import { loadTimeBlock, saveTimeBlock } from '@/server/admin/time-blocks';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { loadClinicSettings } from '@/server/settings';
import { loadDayView } from '@/server/slots/day-view';
import { isSlotFree } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
const date = '2026-10-20';
let database: TestDatabase;
let clinic: SeededClinic;
let deps: BookingDependencies;

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 2, lateCancellationHours: 0 } });
  deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
});

function blockFields() {
  return {
    practitionerId: clinic.practitioners.weekdays,
    startsAt: `${date}T09:50`,
    endsAt: `${date}T11:20`,
  };
}

async function saveBlock(overrides: Partial<Parameters<typeof saveTimeBlock>[3]> = {}) {
  const result = await saveTimeBlock(database.db, clock, clinic.settings.timeZone, { ...blockFields(), ...overrides });
  if (!('id' in result)) throw new Error(`Time block refused: ${result.error}`);
  return result.id;
}

function dayView(practitionerId = clinic.practitioners.weekdays) {
  return loadDayView(database.db, clock, { practitionerId, date });
}

it('saves a practitioner time block with or without a reason', async () => {
  const withReason = await saveBlock({ reason: '  Training  ' });
  const withoutReason = await saveBlock({ startsAt: '2026-10-24T09:00', endsAt: '2026-10-26T09:00' });
  const rows = await database.db.select().from(timeBlocks).orderBy(asc(timeBlocks.startsAt));
  expect(rows).toMatchObject([
    {
      id: withReason,
      practitionerId: clinic.practitioners.weekdays,
      startsAt: new Date('2026-10-20T08:50:00Z'),
      endsAt: new Date('2026-10-20T10:20:00Z'),
      reason: 'Training',
    },
    {
      id: withoutReason,
      startsAt: new Date('2026-10-24T08:00:00Z'),
      endsAt: new Date('2026-10-26T09:00:00Z'),
      reason: null,
    },
  ]);
});

it('refuses invalid dates, unknown practitioners, reversed times and times during a clock change', async () => {
  const invalid = [
    [{ practitionerId: '00000000-0000-4000-8000-000000000000' }, 'practitionerId'],
    [{ startsAt: '2026-02-30T09:00' }, 'startsAt'],
    [{ endsAt: blockFields().startsAt }, 'order'],
    [{ endsAt: `${date}T09:49` }, 'order'],
    [{ reason: 'x'.repeat(501) }, 'reason'],
    [{ startsAt: '2026-03-29T01:30' }, 'clock_change'],
    [{ endsAt: '2026-10-25T01:30' }, 'clock_change'],
  ] as const;
  for (const [override, error] of invalid) {
    const fields = { ...blockFields(), ...override };
    expect(await saveTimeBlock(database.db, clock, clinic.settings.timeZone, fields)).toMatchObject({ error });
  }
  expect(await database.db.select().from(timeBlocks)).toEqual([]);
});

it('requires staff to review the block again if the clinic changes time zone after the form opens', async () => {
  const {
    clinicName,
    timeZone: displayedTimeZone,
    lateCancellationHours,
    includeContactInConfirmation,
  } = await loadClinicSettings(database.db);
  const fields = { ...blockFields(), reason: 'Training' };
  const updatedTimeZone = 'Europe/Paris';
  await updateAdminSettings(database.db, clock, {
    clinicName,
    timeZone: updatedTimeZone,
    lateCancellationHours,
    includeContactInConfirmation,
  });

  expect(await saveTimeBlock(database.db, clock, displayedTimeZone, fields)).toEqual({
    error: 'time_zone_changed',
    field: null,
  });
  expect(await database.db.select().from(timeBlocks)).toEqual([]);

  const result = await saveTimeBlock(database.db, clock, updatedTimeZone, fields);
  expect(result).toHaveProperty('id');
  expect(await database.db.select().from(timeBlocks)).toMatchObject([
    {
      practitionerId: fields.practitionerId,
      startsAt: new Date('2026-10-20T07:50:00Z'),
      endsAt: new Date('2026-10-20T09:20:00Z'),
      reason: fields.reason,
    },
  ]);
});

it('hides every overlapping slot for the blocked practitioner from the client day view', async () => {
  const first = (await dayView()).slots;
  const other = (await dayView(clinic.practitioners.saturdays)).slots;
  await saveBlock();
  expect((await dayView()).slots.map((slot) => slot.id)).toEqual([first[0]!.id, ...first.slice(4).map((s) => s.id)]);
  expect((await dayView(clinic.practitioners.saturdays)).slots).toEqual(other);
  expect(await isSlotFree(database.db, first[1]!.id)).toBe(false);
  await saveBlock({ startsAt: `${date}T12:45`, endsAt: `${date}T14:15` });
  expect(await isSlotFree(database.db, first[4]!.id)).toBe(true); // ends at the start
  expect(await isSlotFree(database.db, first[5]!.id)).toBe(false);
  expect(await isSlotFree(database.db, first[7]!.id)).toBe(true); // starts at the end
});

it('lists only overlapping confirmed bookings with client names and session times', async () => {
  const first = (await dayView()).slots;
  const other = (await dayView(clinic.practitioners.saturdays)).slots;
  const patientId = clinic.patient1.id;
  await bookSlot(deps, { patientId, slotId: first[0]!.id });
  const overlappingStart = await bookSlot(deps, { patientId, slotId: first[1]!.id });
  const cancelled = await bookSlot(deps, { patientId, slotId: first[2]!.id });
  const overlappingEnd = await bookSlot(deps, { patientId: clinic.patient2.id, slotId: first[3]!.id });
  await bookSlot(deps, { patientId, slotId: first[4]!.id });
  await bookSlot(deps, { patientId, slotId: other[0]!.id });
  await cancelBooking(deps, { patientId, bookingId: cancelled.id });

  const block = await loadTimeBlock(database.db, await saveBlock());
  expect(block?.bookings).toMatchObject([
    {
      id: overlappingStart.id,
      patientName: clinic.patient1.name,
      startsAt: first[1]!.startsAt,
      endsAt: first[1]!.endsAt,
      status: 'confirmed',
    },
    {
      id: overlappingEnd.id,
      patientName: clinic.patient2.name,
      startsAt: first[3]!.startsAt,
      endsAt: first[3]!.endsAt,
      status: 'confirmed',
    },
  ]);
});

it('leaves existing bookings unchanged when a time block is saved', async () => {
  const first = (await dayView()).slots;
  const mailer = recordingMailer();
  const patientId = clinic.patient1.id;
  await bookSlot({ ...deps, mail: testMail(mailer) }, { patientId, slotId: first[1]!.id, phone: '+44 7700 900001' });
  const cancelled = await bookSlot(deps, { patientId, slotId: first[2]!.id });
  await cancelBooking(deps, { patientId, bookingId: cancelled.id });
  const before = await database.db.select().from(bookings).orderBy(asc(bookings.id));
  await saveBlock();
  expect(await database.db.select().from(bookings).orderBy(asc(bookings.id))).toEqual(before);
  expect(mailer.sent).toHaveLength(1);
});

it('refuses stale booking and rescheduling submissions for blocked slots', async () => {
  const first = (await dayView()).slots;
  const patientId = clinic.patient1.id;
  const existing = await bookSlot(deps, { patientId, slotId: first[0]!.id });
  await saveBlock();

  await expect(bookSlot(deps, { patientId, slotId: first[1]!.id })).rejects.toMatchObject({ code: 'slot_blocked' });
  await expect(
    rescheduleBooking(deps, { patientId, bookingId: existing.id, newSlotId: first[2]!.id }),
  ).rejects.toMatchObject({ code: 'slot_blocked' });
  expect(await database.db.select().from(bookings)).toMatchObject([
    { id: existing.id, slotId: existing.slotId, status: 'confirmed', rescheduleCount: 0 },
  ]);
});

it('rechecks a pending time block after waiting for the staff transaction', async () => {
  const slot = (await dayView()).slots[1]!;
  const staff = await database.handle.pool.connect();
  try {
    await staff.query('begin');
    const { rows } = await staff.query<{ pid: number }>('select pg_backend_pid() as pid');
    const staffPid = rows[0]!.pid;
    await staff.query('select id from practitioner where id = $1 for no key update', [slot.practitionerId]);
    await staff.query(
      'insert into time_block (id, practitioner_id, starts_at, ends_at, created_at) values ($1, $2, $3, $4, $5)',
      [newId(clock), slot.practitionerId, slot.startsAt, slot.endsAt, clock.now()],
    );
    const attempt = bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id }).catch((error: unknown) => error);
    await expect
      .poll(
        async () => {
          const result = await database.db.execute(
            sql`select pid from pg_stat_activity where ${staffPid} = any(pg_blocking_pids(pid))`,
          );
          return result.rowCount;
        },
        { timeout: 5_000 },
      )
      .toBe(1);
    await staff.query('commit');
    expect(await attempt).toMatchObject({ code: 'slot_blocked' });
    expect(await database.db.select().from(bookings)).toEqual([]);
  } finally {
    await staff.query('rollback');
    staff.release();
  }
});
