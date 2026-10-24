import { createHash } from 'node:crypto';
import { asc, count, eq, gt, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import type { Database, Executor } from '@/db/client';
import { bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { addDaysToLocalDate, addHours, addMinutes, localDateOf, timeZoneOffsetMs, zonedTimeToUtc } from '@/lib/time';
import { ENVIRONMENTS } from '@/lib/runtime-identity';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/password';
import { ensureSlotsThroughHorizon } from '../slots/ensure';
import { tenantSchema, type Tenant } from './tenant';

export const seedEnvironment = z.enum(ENVIRONMENTS);
const passwordsSchema = z.record(z.string(), z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH));
const SEED_VERSION = 1;

/** Keep a 09:00 reference on each side even when seeding late on the preceding day. */
export function clockChangeReferenceStarts(now: Date, timeZone: string): Date[] {
  const firstDate = localDateOf(now, timeZone);
  const offset = timeZoneOffsetMs(now.getTime(), timeZone);
  for (let day = 0; day <= 220; day++) {
    const date = addDaysToLocalDate(firstDate, day);
    const noon = zonedTimeToUtc(date, '12:00', timeZone)!;
    if (timeZoneOffsetMs(noon.getTime(), timeZone) !== offset) {
      return [-1, 1].map((delta) => zonedTimeToUtc(addDaysToLocalDate(date, delta), '09:00', timeZone)!);
    }
  }
  throw new Error('No clock change found within the demo booking horizon');
}

export function validatePasswords(tenant: Tenant, input: unknown): Record<string, string> {
  const result = passwordsSchema.safeParse(input);
  const expected = tenant.accounts.map((user) => user.email);
  if (
    !result.success ||
    Object.keys(result.data).length !== expected.length ||
    expected.some((email) => !(email in result.data))
  ) {
    // Never include input, account names or Zod diagnostics containing values.
    throw new Error('Supply one valid password for each configured test account, and no other accounts.');
  }
  return result.data;
}

export async function assertSeedIdentity(db: Executor, tenant: string, environment: string): Promise<void> {
  const result = await db.execute<{ tenant: string; environment: string }>(
    sql`select tenant, environment from bookit_seed_state where singleton = true`,
  );
  if (result.rows.length !== 1 || result.rows[0]?.tenant !== tenant || result.rows[0]?.environment !== environment) {
    throw new Error('Seeded database identity does not match this container.');
  }
}

async function counts(db: Executor) {
  const [userCount] = await db.select({ count: count() }).from(users);
  const [practitionerCount] = await db.select({ count: count() }).from(practitioners);
  const [slotCount] = await db.select({ count: count() }).from(slots);
  const [bookingCount] = await db.select({ count: count() }).from(bookings);
  return {
    users: userCount!.count,
    practitioners: practitionerCount!.count,
    slots: slotCount!.count,
    bookings: bookingCount!.count,
  };
}

/** Initialise one fictional clinic database atomically. A restart never resets user activity. */
export async function seedTenant(
  db: Database,
  clock: Clock,
  input: { tenant: Tenant; environment: string; passwords: unknown },
) {
  const tenant = tenantSchema.parse(input.tenant);
  const environment = seedEnvironment.parse(input.environment);
  const passwords = validatePasswords(tenant, input.passwords);
  const now = clock.now();
  const fixedClock: Clock = { now: () => new Date(now) };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ version: SEED_VERSION, tenant }))
    .digest('hex');
  const id = (label: string) => uuidv5(`bookit-demo:${tenant.tenant}:${environment}:${label}`, uuidv5.URL);
  return db.transaction(async (tx) => {
    // Serialise first-run initialisation, including creation of the seed-only metadata table.
    await tx.execute(sql`select pg_advisory_xact_lock(240024)`);
    await tx.execute(sql`create table if not exists bookit_seed_state (
      singleton boolean primary key check (singleton), tenant text not null,
      environment text not null, fingerprint text not null, seeded_at timestamptz not null
    )`);
    const state = await tx.execute<{ tenant: string; environment: string; fingerprint: string }>(
      sql`select tenant, environment, fingerprint from bookit_seed_state where singleton = true`,
    );
    const bound = state.rows[0];
    if (bound) {
      if (bound.tenant !== tenant.tenant || bound.environment !== environment || bound.fingerprint !== fingerprint) {
        throw new Error('Seed database identity or configuration differs; use a separate empty database.');
      }
      return { tenant: tenant.tenant, environment, outcome: 'unchanged' as const, counts: await counts(tx) };
    }
    const existing = await counts(tx);
    const settings = await tx.select({ count: count() }).from(clinicSettings);
    if (Object.values(existing).some((value) => value !== 0) || settings[0]!.count !== 0) {
      throw new Error('Refusing to seed a nonempty database without a matching seed identity.');
    }
    await tx.insert(clinicSettings).values({ id: 1, ...tenant.settings, updatedAt: now });
    for (const account of tenant.accounts) {
      await tx.insert(users).values({
        ...account,
        id: id(account.email),
        passwordHash: await hashPassword(passwords[account.email]!),
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const [index, practitioner] of tenant.practitioners.entries()) {
      await tx
        .insert(practitioners)
        .values({ ...practitioner, id: id(`practitioner:${index}`), active: true, createdAt: now, updatedAt: now });
    }
    await ensureSlotsThroughHorizon(tx, fixedClock);
    for (const [index, startsAt] of clockChangeReferenceStarts(now, tenant.settings.timeZone).entries()) {
      await tx
        .insert(slots)
        .values({
          id: id(`clock-change:${index}`),
          practitionerId: id('practitioner:0'),
          startsAt,
          endsAt: addMinutes(startsAt, tenant.settings.sessionMinutes),
          createdAt: now,
        })
        .onConflictDoNothing();
    }
    const lateStart = addHours(now, 3);
    await tx
      .insert(slots)
      .values({
        id: id('late-slot'),
        practitionerId: id('practitioner:0'),
        startsAt: lateStart,
        endsAt: addMinutes(lateStart, tenant.settings.sessionMinutes),
        createdAt: now,
      })
      .onConflictDoNothing();
    const [lateSlot] = await tx.select({ id: slots.id }).from(slots).where(eq(slots.startsAt, lateStart));
    const laterSlots = await tx
      .select({ id: slots.id })
      .from(slots)
      .where(gt(slots.startsAt, lateStart))
      .orderBy(asc(slots.startsAt))
      .limit(tenant.accounts.length);
    for (const [index, patient] of tenant.accounts.filter((account) => account.role === 'patient').entries()) {
      const slotId = index === 0 ? lateSlot?.id : laterSlots[index - 1]?.id;
      if (!slotId) throw new Error('Seed booking slot unavailable');
      await tx.insert(bookings).values({
        id: id(`booking:${index}`),
        patientId: id(patient.email),
        slotId,
        status: 'confirmed',
        lateCancellation: false,
        phone: patient.phone,
        rescheduleCount: 0,
        createdAt: now,
        updatedAt: now,
        cancelledAt: null,
      });
    }
    await tx.execute(
      sql`insert into bookit_seed_state (singleton, tenant, environment, fingerprint, seeded_at) values (true, ${tenant.tenant}, ${environment}, ${fingerprint}, ${now.toISOString()})`,
    );
    return { tenant: tenant.tenant, environment, outcome: 'created' as const, counts: await counts(tx) };
  });
}
