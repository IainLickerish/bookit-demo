import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { users } from '@/db/schema';
import { adminReportResponse } from '@/server/admin/http';
import { createSession } from '@/server/auth/session';
import { seedAdminBookings } from '../helpers/admin-fixture';
import { seedClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';

it('downloads only the filtered bookings with their original client names', async () => {
  const { db, stop } = await startTestDatabase();
  try {
    const clock = manualClock('2026-10-20T07:00:00Z');
    const { admin } = await seedClinic(db, clock, { settings: { slotHorizonDays: 7 } });
    const { bookingIds, practitionerId } = await seedAdminBookings(db, clock, 'csv-download');
    await db.update(users).set({ name: 'Zoë Brontë' }).where(eq(users.email, 'csv-download-1@patients.example.test'));
    await db.update(users).set({ name: '林 美玲' }).where(eq(users.email, 'csv-download-2@patients.example.test'));
    const { token } = await createSession(db, clock, admin.id);
    const { log } = captureLogs(clock, 'acme');
    const filters = new URLSearchParams({ practitionerId, date: '2026-10-25' });

    const response = await adminReportResponse({ db, clock, log }, token, filters, 'csv');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    const csv = Buffer.from(await response.arrayBuffer()).toString('utf8');
    const bookingFields = csv.trimEnd().split('\r\n').slice(1);
    expect(bookingFields.map((record) => record.split(',').slice(0, 2))).toEqual([
      [`"${bookingIds[1]}"`, '"Zoë Brontë"'],
      [`"${bookingIds[2]}"`, '"林 美玲"'],
    ]);
  } finally {
    await stop();
  }
});
