import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { practitioners, sessions, slots, users } from '@/db/schema';
import { localDateOf } from '@/lib/time';
import { authenticate, createSession, deleteSession, findSessionUser, SESSION_TTL_HOURS } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { postgresErrorOf } from '@/server/errors';
import { loadDayView } from '@/server/slots/day-view';
import { ensureSlotsThroughHorizon } from '@/server/slots/ensure';
import { listAvailableSlots } from '@/server/slots/queries';
import { createUser } from '@/server/users';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';

let database: TestDatabase;
let clinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
});

describe('patient sign-in and sessions (REQ-18.1-01)', () => {
  it('signs in with email and password, ignoring email case and spaces', async () => {
    const user = await authenticate(database.db, '  Patient1@Patients.Example.TEST ', TEST_PASSWORD);
    expect(user).toMatchObject({ id: clinic.patient1.id, role: 'patient' });
  });

  it('refuses a wrong password or an unknown email', async () => {
    expect(await authenticate(database.db, 'patient1@patients.example.test', 'wrong-password-123')).toBeNull();
    expect(await authenticate(database.db, 'nobody@patients.example.test', TEST_PASSWORD)).toBeNull();
    expect(await authenticate(database.db, 'not an email', TEST_PASSWORD)).toBeNull();
  });

  it('stores only a hash of the password and of the session token', async () => {
    const [row] = await database.db.select().from(users).where(eq(users.id, clinic.patient1.id));
    expect(row?.passwordHash).toMatch(/^scrypt\$/);
    const session = await createSession(database.db, clock, clinic.patient1.id);
    const stored = await database.db.select().from(sessions);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(session.token);
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ends a session when it expires on the clock or the patient signs out', async () => {
    const session = await createSession(database.db, clock, clinic.patient1.id);
    expect(session.expiresAt.toISOString()).toBe('2026-10-20T19:00:00.000Z');
    expect((await findSessionUser(database.db, clock, session.token))?.id).toBe(clinic.patient1.id);
    clock.advanceMinutes(SESSION_TTL_HOURS * 60);
    expect(await findSessionUser(database.db, clock, session.token)).toBeNull();
    clock.set('2026-10-20T07:00:00Z');
    expect(await findSessionUser(database.db, clock, 'forged-token')).toBeNull();
    await deleteSession(database.db, session.token);
    expect(await findSessionUser(database.db, clock, session.token)).toBeNull();
  });

  it('keeps email addresses unique regardless of case', async () => {
    const duplicate = createUser(database.db, clock, {
      email: 'PATIENT1@patients.example.test',
      name: 'Duplicate',
      role: 'patient',
      password: TEST_PASSWORD,
    });
    await expect(duplicate.catch((e: unknown) => postgresErrorOf(e))).resolves.toEqual({
      code: '23505',
      constraint: 'user_email_key',
    });
  });
});

describe('slots up to the booking horizon (REQ-18.1-01)', () => {
  it('seeds slots for every active practitioner up to the horizon and is safe to run again', async () => {
    expect(clinic.slotsCreated).toBeGreaterThan(2000);
    const [{ total } = { total: 0 }] = await database.db.select({ total: count() }).from(slots);
    expect(total).toBe(clinic.slotsCreated);
    expect(await ensureSlotsThroughHorizon(database.db, clock)).toBe(0);
  });

  it('adds only the newly reachable days when the clock moves on', async () => {
    clock.set('2026-10-27T07:00:00Z');
    const added = await ensureSlotsThroughHorizon(database.db, clock);
    // One week later: five more weekdays for Pat (10 a day) and three more
    // Tuesday/Thursday/Saturday days for Sam (8 a day).
    expect(added).toBe(5 * 10 + 3 * 8);
  });

  it('lists only free, future slots of active practitioners within the horizon', async () => {
    const query = {
      practitionerId: clinic.practitioners.weekdays,
      after: clock.now(),
      until: new Date('2026-10-21T00:00:00Z'),
    };
    const before = await listAvailableSlots(database.db, query);
    expect(before).toHaveLength(10);
    await bookSlot(
      { db: database.db, clock, log: captureLogs(clock).log },
      { patientId: clinic.patient1.id, slotId: before[0]!.id },
    );
    const after = await listAvailableSlots(database.db, query);
    expect(after.map((s) => s.id)).toEqual(before.slice(1).map((s) => s.id));
    await database.db
      .update(practitioners)
      .set({ active: false })
      .where(eq(practitioners.id, clinic.practitioners.weekdays));
    expect(await listAvailableSlots(database.db, query)).toEqual([]);
  });

  it('shows one day of a practitioner, keeping the requested date between today and the last bookable date', async () => {
    const view = await loadDayView(database.db, clock, {
      practitionerId: clinic.practitioners.saturdays,
      date: '2026-10-24',
    });
    expect(view).toMatchObject({
      today: '2026-10-20',
      lastDate: '2027-05-28',
      date: '2026-10-24',
      practitioner: { id: clinic.practitioners.saturdays, name: 'Sam Sports' },
    });
    expect(view.slots).toHaveLength(8);
    for (const slot of view.slots) {
      expect(localDateOf(slot.startsAt, 'Europe/London')).toBe('2026-10-24');
    }
    // Both sides of the next clock change are visible and bookable.
    const afterChange = await loadDayView(database.db, clock, {
      practitionerId: clinic.practitioners.weekdays,
      date: '2026-10-26',
    });
    expect(afterChange.slots[0]?.startsAt.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    for (const date of ['2026-10-19', '2027-06-01', 'yesterday']) {
      expect((await loadDayView(database.db, clock, { date })).date).toBe('2026-10-20');
    }
    expect((await loadDayView(database.db, clock, { practitionerId: 'unknown' })).practitioner?.name).toBe(
      'Pat Physio',
    );
  });
});
