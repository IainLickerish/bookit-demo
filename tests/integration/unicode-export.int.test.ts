import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookings, clinicSettings, users } from '@/db/schema';
import { createSession } from '@/server/auth/session';
import { adminReportResponse } from '@/server/admin/http';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';

describe('Unicode CSV response and stored data', () => {
  it.each(['acme', 'beacon'] as const)(
    '%s exports UTF-8 without changing names, bookings or settings',
    async (name) => {
      const database = await startTestDatabase();
      try {
        const clock = manualClock('2026-10-20T07:00:00Z');
        const tenant = loadTenant(name);
        tenant.settings.slotHorizonDays = 7;
        tenant.accounts[1]!.name = 'Zoe\u0308 Bronte\u0308';
        tenant.accounts[2]!.name = '架空, "Δοκιμή"\nعميل تجريبي';
        await seedTenant(database.db, clock, {
          tenant,
          environment: 'local',
          passwords: Object.fromEntries(tenant.accounts.map((account) => [account.email, TEST_PASSWORD])),
        });
        const [admin] = await database.db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
        const { token } = await createSession(database.db, clock, admin!.id);
        const deps = { db: database.db, clock, log: captureLogs(clock, name).log };
        const snapshot = async () => ({
          names: await database.db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.id)),
          bookings: await database.db.select().from(bookings).orderBy(asc(bookings.id)),
          settings: await database.db.select().from(clinicSettings),
        });
        const before = await snapshot();
        const response = await adminReportResponse(deps, token, new URLSearchParams(), 'csv');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="bookings.csv"');
        const bytes = Buffer.from(await response.arrayBuffer());
        expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        const text = bytes.toString('utf8');
        expect(text).toContain(tenant.accounts[0]!.name);
        expect(text).toContain('"Zoe\u0308 Bronte\u0308"');
        expect(text).toContain('"架空, ""Δοκιμή""\nعميل تجريبي"');
        for (const booking of before.bookings) expect(text).toContain(`"${booking.id}"`);
        expect(text).toContain(name === 'acme' ? '"\'+44 7700 900001"' : '"\'+44 7700 900002"');
        expect(text).toContain(',""\r\n');
        expect(await snapshot()).toEqual(before);
      } finally {
        await database.stop();
      }
    },
  );
});
