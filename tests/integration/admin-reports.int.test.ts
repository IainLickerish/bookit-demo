import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '@/db/schema';
import { createSession } from '@/server/auth/session';
import { adminReportResponse } from '@/server/admin/http';
import { updateAdminSettings } from '@/server/admin/settings';
import { loadClinicSettings } from '@/server/settings';
import { createUser } from '@/server/users';
import { seedAdminBookings, ADMIN_PATIENT_NAMES } from '../helpers/admin-fixture';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';

let acme: TestDatabase;
let clinic: SeededClinic;
let adminToken: string;
let patientToken: string;
let fixture: Awaited<ReturnType<typeof seedAdminBookings>>;
const clock = manualClock('2026-10-20T07:00:00Z');
const logs = captureLogs(clock, 'acme');

beforeAll(async () => {
  acme = await startTestDatabase();
  clinic = await seedClinic(acme.db, clock, { settings: { slotHorizonDays: 7 } });
  fixture = await seedAdminBookings(acme.db, clock);
  adminToken = (await createSession(acme.db, clock, clinic.admin.id)).token;
  patientToken = (await createSession(acme.db, clock, clinic.patient1.id)).token;
});
afterAll(async () => {
  await acme?.stop();
});

function report(query = '', token: string | undefined = adminToken, format: 'csv' | 'report' = 'csv') {
  return adminReportResponse({ db: acme.db, clock, log: logs.log }, token, new URLSearchParams(query), format);
}

describe('M0-24b REQ-18.1-01 REQ-18.1-03 admin export, filters and security', () => {
  it('exports fictional names, with attachment headers and privacy-safe count logs', async () => {
    const response = await report();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    for (const name of ADMIN_PATIENT_NAMES.slice(0, 3)) expect(bytes.toString('utf8')).toContain(name);
    expect(bytes.toString('utf8')).toContain('"Ada, ""Clinic""\nTest"');
    expect(logs.lines).toContainEqual(expect.objectContaining({ event: 'admin.export', tenant: 'acme', row_count: 4 }));
    const text = JSON.stringify(logs.lines);
    for (const value of [...ADMIN_PATIENT_NAMES, TEST_PASSWORD, adminToken, patientToken])
      expect(text).not.toContain(value);
  });
  it('downloads filtered CSV bookings with client names exactly as written', async () => {
    const response = await report(`practitionerId=${fixture.practitionerId}&date=2026-10-25`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    const csv = Buffer.from(await response.arrayBuffer()).toString('utf8');
    expect(csv).toContain(`"${fixture.bookingIds[1]}","Łukasz Wiśniewski",`);
    expect(csv).toContain(`"${fixture.bookingIds[2]}","Siobhán Ó Briain",`);
    expect(csv).not.toContain(fixture.bookingIds[0]);
    expect(csv).not.toContain(fixture.bookingIds[3]);
  });
  it('applies clinic-local date boundaries across the 25-hour clock-change day, with practitioner and status filters', async () => {
    const response = await report(
      `type=bookings&practitionerId=${fixture.practitionerId}&date=2026-10-25`,
      adminToken,
      'report',
    );
    const result = (await response.json()) as { bookings: { id: string }[] };
    expect(result.bookings.map((row) => row.id)).toEqual(fixture.bookingIds.slice(1, 3));
    const summary = await report(`type=summary&date=2026-10-25&status=cancelled`, adminToken, 'report');
    expect(await summary.json()).toEqual({ total: 1, confirmed: 0, cancelled: 1, lateCancellations: 1 });
    const empty = await report(`type=bookings&practitionerId=${clinic.practitioners.weekdays}`, adminToken, 'report');
    expect(await empty.json()).toEqual({ bookings: [] });
  });
  it('refuses missing, forged, expired and patient sessions before reading data', async () => {
    for (const token of ['', 'forged', patientToken]) {
      for (const format of ['csv', 'report'] as const) {
        const response = await report('', token, format);
        expect(response.status).toBe(token === patientToken ? 403 : 401);
        expect(await response.text()).not.toContain('Brontë');
      }
    }
    const expired = await createSession(acme.db, manualClock('2026-10-19T07:00:00Z'), clinic.admin.id);
    expect((await report('', expired.token)).status).toBe(401);
  });
  it('rechecks the current role even for an existing admin session', async () => {
    const user = await createUser(acme.db, clock, {
      name: 'Former admin',
      email: 'former-admin@example.test',
      password: TEST_PASSWORD,
      role: 'admin',
    });
    const token = (await createSession(acme.db, clock, user.id)).token;
    await acme.db.update(users).set({ role: 'patient' }).where(eq(users.id, user.id));
    expect((await report('', token)).status).toBe(403);
  });
  it('refuses request clinic selectors and malformed dates', async () => {
    for (const query of ['tenant=other', 'product=OTHER', 'date=2026-02-30', 'date=2026-10-25&date=2026-10-26']) {
      expect((await report(query)).status).toBe(400);
    }
  });
  it('keeps untrusted report input out of the browser error response', async () => {
    const response = await report('type=not-a-report', adminToken, 'report');
    expect(response.ok).toBe(false);
    expect((await response.text()).includes('not-a-report')).toBe(false);
  });
  it('updates only editable settings and refuses invalid input without a write', async () => {
    const before = await loadClinicSettings(acme.db);
    const updated = {
      clinicName: 'Acme Admin Clinic',
      timeZone: 'Europe/Paris',
      lateCancellationHours: 48,
      includeContactInConfirmation: false,
    };
    try {
      await updateAdminSettings(acme.db, clock, updated);
      expect(await loadClinicSettings(acme.db)).toEqual({ ...before, ...updated });
      await expect(updateAdminSettings(acme.db, clock, { ...updated, lateCancellationHours: -1 })).rejects.toThrow();
      expect(await loadClinicSettings(acme.db)).toEqual({ ...before, ...updated });
    } finally {
      await updateAdminSettings(acme.db, clock, {
        clinicName: before.clinicName,
        timeZone: before.timeZone,
        lateCancellationHours: before.lateCancellationHours,
        includeContactInConfirmation: before.includeContactInConfirmation,
      });
    }
  });
});
