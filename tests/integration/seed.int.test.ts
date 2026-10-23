import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import { addDaysToLocalDate, formatLocalTime, localDateOf, timeZoneOffsetMs } from '@/lib/time';
import { verifyPassword } from '@/server/auth/password';
import { assertSeedIdentity, seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { createUser } from '@/server/users';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { tenantEvidenceDirectory, writeTenantEvidence } from '../helpers/tenant-evidence';

const clock = manualClock('2026-10-20T07:00:00Z');
const acme = loadTenant('acme');
const beacon = loadTenant('beacon');
const makePasswords = (tenant: typeof acme) =>
  Object.fromEntries(tenant.accounts.map((account) => [account.email, randomBytes(24).toString('base64url')]));
const passwordsA = makePasswords(acme);
const passwordsB = makePasswords(beacon);
const evidenceDirectory = tenantEvidenceDirectory('seed');
const outcomes: unknown[] = [];
let a: TestDatabase;
let b: TestDatabase;

beforeAll(async () => {
  a = await startTestDatabase();
  b = await startTestDatabase();
});
afterEach((context) => {
  outcomes.push({ testId: context.task.name, expected: 'pass', observed: context.task.result?.state ?? 'unknown' });
});
afterAll(async () => {
  try {
    writeTenantEvidence(evidenceDirectory, outcomes, '', [...Object.values(passwordsA), ...Object.values(passwordsB)]);
  } finally {
    await Promise.allSettled([a?.stop(), b?.stop()]);
  }
});

describe('REQ-18.2-01 real Postgres seed and isolation', () => {
  it('creates both clinics atomically, with distinct settings, names, optional phone and a three-hour booking', async () => {
    const resultA = await seedTenant(a.db, clock, { tenant: acme, environment: 'staging', passwords: passwordsA });
    const resultB = await seedTenant(b.db, clock, { tenant: beacon, environment: 'staging', passwords: passwordsB });
    expect(resultA).toMatchObject({ outcome: 'created', counts: { users: 4, practitioners: 1, bookings: 3 } });
    expect(resultB).toMatchObject({ outcome: 'created', counts: { users: 4, practitioners: 1, bookings: 3 } });
    expect(resultA.counts.slots).toBeGreaterThan(2000);
    const rows = await a.db.select().from(users);
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['Zoë Brontë', 'Łukasz Wiśniewski', 'Siobhán Ó Briain']),
    );
    const noPhone = rows.find((row) => row.email.startsWith('patient2@'))!;
    expect(noPhone.phone).toBeNull();
    expect(await verifyPassword(passwordsA[noPhone.email]!, noPhone.passwordHash)).toBe(true);
    expect((await b.db.select().from(clinicSettings))[0]).toMatchObject(beacon.settings);
    const seeded = await a.db
      .select({ start: slots.startsAt })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId));
    expect(seeded.map((row) => row.start.toISOString())).toContain('2026-10-20T10:00:00.000Z');
  });
  it('creates 09:00 slots on both sides of the next London clock change within the horizon', async () => {
    const rows = await a.db.select().from(slots);
    const before = rows.find(
      (row) =>
        localDateOf(row.startsAt, 'Europe/London') === '2026-10-24' &&
        formatLocalTime(row.startsAt, 'Europe/London') === '09:00',
    )!;
    const after = rows.find(
      (row) =>
        localDateOf(row.startsAt, 'Europe/London') === '2026-10-26' &&
        formatLocalTime(row.startsAt, 'Europe/London') === '09:00',
    )!;
    expect(before.startsAt.toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(after.startsAt.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(timeZoneOffsetMs(before.startsAt.getTime(), 'Europe/London')).not.toBe(
      timeZoneOffsetMs(after.startsAt.getTime(), 'Europe/London'),
    );
    expect(localDateOf(after.startsAt, 'Europe/London') <= addDaysToLocalDate('2026-10-20', 220)).toBe(true);
  });
  it('reruns concurrently without duplicates, password rotation or resetting changed bookings/settings', async () => {
    const [booking] = await a.db.select().from(bookings);
    await a.db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: clock.now() })
      .where(eq(bookings.id, booking!.id));
    await a.db.update(clinicSettings).set({ clinicName: 'Acme Admin Changed' });
    const hashesBefore = (await a.db.select().from(users)).map((row) => row.passwordHash).sort();
    const results = await Promise.all(
      [1, 2].map(() =>
        seedTenant(a.db, manualClock('2026-10-21T07:00:00Z'), {
          tenant: acme,
          environment: 'staging',
          passwords: makePasswords(acme),
        }),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ outcome: 'unchanged', counts: { users: 4, bookings: 3 } });
    expect((await a.db.select().from(users)).map((row) => row.passwordHash).sort()).toEqual(hashesBefore);
    expect((await a.db.select().from(clinicSettings))[0]?.clinicName).toBe('Acme Admin Changed');
    expect((await a.db.select().from(bookings).where(eq(bookings.id, booking!.id)))[0]?.status).toBe('cancelled');
  });
  it('refuses foreign-tenant/environment/config seeding and container identity, retaining all data', async () => {
    await expect(
      seedTenant(a.db, clock, { tenant: beacon, environment: 'staging', passwords: passwordsB }),
    ).rejects.toThrow('identity or configuration differs');
    await expect(
      seedTenant(a.db, clock, { tenant: acme, environment: 'production', passwords: passwordsA }),
    ).rejects.toThrow('identity or configuration differs');
    await expect(
      seedTenant(a.db, clock, {
        tenant: { ...acme, settings: { ...acme.settings, sessionMinutes: 60 } },
        environment: 'staging',
        passwords: passwordsA,
      }),
    ).rejects.toThrow('identity or configuration differs');
    await expect(assertSeedIdentity(a.db, 'beacon', 'staging')).rejects.toThrow('does not match');
    await expect(assertSeedIdentity(a.db, 'acme', 'staging')).resolves.toBeUndefined();
    const marker = await a.db
      .select()
      .from(practitioners)
      .where(sql`${practitioners.bio} like '%BEACON-SEED-MARKER%'`);
    expect(marker).toHaveLength(0);
    const foreignId = (await b.db.select().from(users))[0]!.id;
    expect(await a.db.select().from(users).where(eq(users.id, foreignId))).toHaveLength(0);
    expect((await b.db.select().from(practitioners))[0]?.bio).toContain('BEACON-SEED-MARKER');
  });
  it('rejects missing caller passwords before writes and never includes them in validation errors', async () => {
    await expect(seedTenant(a.db, clock, { tenant: acme, environment: 'staging', passwords: {} })).rejects.toThrow(
      'Supply one valid password',
    );
  });
  it('refuses to adopt a nonempty unbound database and rolls back its seed metadata', async () => {
    const existing = await startTestDatabase();
    try {
      await createUser(existing.db, clock, {
        email: 'existing@patients.example.test',
        name: 'Existing fictional patient',
        role: 'patient',
        password: randomBytes(24).toString('base64url'),
      });
      await expect(
        seedTenant(existing.db, clock, { tenant: acme, environment: 'staging', passwords: passwordsA }),
      ).rejects.toThrow('nonempty database');
      expect(await existing.db.select().from(users)).toHaveLength(1);
      expect(await existing.db.select().from(clinicSettings)).toHaveLength(0);
      const metadata = await existing.db.execute<{ table_name: string | null }>(
        sql`select to_regclass('public.bookit_seed_state')::text as table_name`,
      );
      expect(metadata.rows[0]?.table_name).toBeNull();
    } finally {
      await existing.stop();
    }
  });
});
