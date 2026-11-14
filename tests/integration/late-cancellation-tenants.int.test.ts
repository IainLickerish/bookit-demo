import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bookings, users } from '@/db/schema';
import { listAdminBookings } from '@/server/admin/bookings';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient, listBookingsForPatient } from '@/server/bookings/queries';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { listAvailableSlots } from '@/server/slots/queries';
import { TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
const clinics: { database: TestDatabase; deps: BookingDependencies; patientId: string; otherId: string }[] = [];

beforeAll(async () => {
  for (const name of ['acme', 'beacon'] as const) {
    const database = await startTestDatabase();
    const tenant = loadTenant(name);
    const deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail(recordingMailer()) };
    // Register cleanup before seeding, so a setup failure also removes the test copy.
    const clinic = { database, deps, patientId: '', otherId: '' };
    clinics.push(clinic);
    await seedTenant(database.db, clock, {
      tenant,
      environment: 'staging',
      passwords: Object.fromEntries(tenant.accounts.map((account) => [account.email, TEST_PASSWORD])),
    });
    const accounts = await database.db.select().from(users);
    clinic.patientId = accounts.find((user) => user.email.startsWith('patient1@'))!.id;
    clinic.otherId = accounts.find((user) => user.email.startsWith('patient2@'))!.id;
  }
});

afterAll(async () => {
  await Promise.all(clinics.map((clinic) => clinic.database.stop()));
});

it.each(['acme', 'beacon'])('preserves existing %s bookings until an authorised late cancellation', async (name) => {
  const clinic = clinics[name === 'acme' ? 0 : 1]!;
  const foreign = clinics[name === 'acme' ? 1 : 0]!;
  const { db } = clinic.database;
  const before = await db.select().from(bookings);
  const [booking] = await listBookingsForPatient(db, clinic.patientId);
  expect(booking).toMatchObject({ status: 'confirmed', lateCancellation: false });
  expect(booking!.startsAt.getTime() - clock.now().getTime()).toBe(3 * 3_600_000);
  await listAdminBookings(db, { status: 'confirmed' }, 'Europe/London');
  expect(await db.select().from(bookings)).toEqual(before);

  for (const patientId of [clinic.otherId, foreign.patientId]) {
    expect(await findBookingForPatient(db, patientId, booking!.id)).toBeNull();
    await expect(cancelBooking(clinic.deps, { patientId, bookingId: booking!.id })).rejects.toMatchObject({
      code: 'booking_not_found',
    });
  }
  expect(await db.select().from(bookings)).toEqual(before);

  const result = await cancelBooking(clinic.deps, { patientId: clinic.patientId, bookingId: booking!.id });
  expect(result).toMatchObject({ late: true, booking: { status: 'cancelled', lateCancellation: true } });
  expect(await listBookingsForPatient(db, clinic.patientId)).toEqual([result.booking]);
  const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking!.id));
  expect(saved).toMatchObject({ status: 'cancelled', lateCancellation: true, cancelledAt: clock.now() });
  expect((await db.select().from(bookings)).filter((row) => row.id !== booking!.id)).toEqual(
    before.filter((row) => row.id !== booking!.id),
  );
  expect(await listAdminBookings(db, { status: 'cancelled' }, 'Europe/London')).toEqual([
    expect.objectContaining({ id: booking!.id, lateCancellation: true }),
  ]);
  expect((await listAdminBookings(db, { status: 'confirmed' }, 'Europe/London')).map((row) => row.id)).not.toContain(
    booking!.id,
  );
  const available = await listAvailableSlots(db, {
    practitionerId: booking!.practitionerId,
    after: clock.now(),
    until: new Date('2026-10-21T07:00:00Z'),
  });
  expect(available.map((slot) => slot.id)).toContain(booking!.slotId);
  const replacement = await bookSlot(clinic.deps, { patientId: clinic.otherId, slotId: booking!.slotId });
  expect(replacement.status).toBe('confirmed');
  await expect(
    cancelBooking(clinic.deps, { patientId: clinic.patientId, bookingId: booking!.id }),
  ).rejects.toMatchObject({ code: 'booking_not_active' });
});
