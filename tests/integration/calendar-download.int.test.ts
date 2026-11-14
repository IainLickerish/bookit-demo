import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '@/server/auth/session';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { bookingCalendar } from '@/server/bookings/calendar';
import { calendarDownloadResponse } from '@/server/bookings/calendar-download';
import { cancelBooking } from '@/server/bookings/cancel';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { findBookingForPatient } from '@/server/bookings/queries';
import { loadTenant } from '@/server/seed/tenant';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

const clock = manualClock('2026-10-20T07:00:00Z');
const clinics: {
  database: TestDatabase;
  clinic: SeededClinic;
  deps: BookingDependencies;
  ownerToken: string;
  otherToken: string;
  adminToken: string;
}[] = [];

beforeAll(async () => {
  for (const name of ['acme', 'beacon'] as const) {
    const database = await startTestDatabase();
    const clinic = await seedClinic(database.db, clock, { settings: loadTenant(name).settings });
    clinics.push({
      database,
      clinic,
      deps: { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() },
      ownerToken: (await createSession(database.db, clock, clinic.patient1.id)).token,
      otherToken: (await createSession(database.db, clock, clinic.patient2.id)).token,
      adminToken: (await createSession(database.db, clock, clinic.admin.id)).token,
    });
  }
});

afterAll(async () => {
  await Promise.all(clinics.map(({ database }) => database.stop()));
});

async function freeSlots(index: number) {
  const { database, clinic } = clinics[index]!;
  return listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: new Date('2026-10-23T00:00:00Z'),
  });
}

describe('private client calendar downloads for both clinics', () => {
  it.each([0, 1])('allows only the booking owner in clinic %i and never caches private responses', async (index) => {
    const { database, clinic, deps, ownerToken, otherToken, adminToken } = clinics[index]!;
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: (await freeSlots(index))[0]!.id });
    const response = await calendarDownloadResponse(database.db, clock, ownerToken, booking.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8; method=PUBLISH');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="booking.ics"');
    expect(await response.text()).toBe(bookingCalendar(booking, clinic.settings));
    for (const [token, status] of [
      [undefined, 401],
      ['invalid', 401],
      [otherToken, 404],
      [adminToken, 403],
      [clinics[1 - index]!.ownerToken, 401],
    ] as const) {
      const refused = await calendarDownloadResponse(database.db, clock, token, booking.id);
      expect(refused.status).toBe(status);
      expect(refused.headers.get('cache-control')).toBe('private, no-store');
      expect(refused.headers.get('vary')).toBe('Cookie');
      expect(await refused.text()).not.toMatch(/BEGIN:VCALENDAR|Physio|Dental|Pat Physio|DTSTART/);
    }
    const foreign = clinics[1 - index]!;
    expect((await calendarDownloadResponse(foreign.database.db, clock, foreign.ownerToken, booking.id)).status).toBe(
      404,
    );
    expect((await calendarDownloadResponse(database.db, clock, ownerToken, 'not-a-uuid')).status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each([0, 1])('keeps saved bookings, moves and downloads when delivery fails in clinic %i', async (index) => {
    const { database, clinic, deps, ownerToken } = clinics[index]!;
    const logs = captureLogs(clock);
    const failing: BookingDependencies = {
      ...deps,
      log: logs.log,
      mail: testMail({ kind: 'smtp', send: () => Promise.reject(new Error('Test delivery failure')) }),
    };
    const slots = await freeSlots(index);
    const booking = await bookSlot(failing, { patientId: clinic.patient1.id, slotId: slots[0]!.id });
    expect((await calendarDownloadResponse(database.db, clock, ownerToken, booking.id)).status).toBe(200);
    const moved = await rescheduleBooking(failing, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: slots[1]!.id,
    });
    expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.slotId).toBe(slots[1]!.id);
    expect(await (await calendarDownloadResponse(database.db, clock, ownerToken, booking.id)).text()).toBe(
      bookingCalendar(moved, clinic.settings),
    );
    expect(logs.events()).toEqual([
      'booking.confirmed',
      'email.confirmation.failed',
      'booking.rescheduled',
      'email.confirmation.failed',
    ]);
  });

  it('refuses cancelled and past bookings and expired sessions', async () => {
    const { database, clinic, deps, ownerToken } = clinics[0]!;
    const slots = await freeSlots(0);
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slots[0]!.id });
    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect((await calendarDownloadResponse(database.db, clock, ownerToken, booking.id)).status).toBe(404);
    const past = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slots[1]!.id });
    const futureClock = manualClock('2026-10-24T07:00:00Z');
    const fresh = await createSession(database.db, futureClock, clinic.patient1.id);
    expect((await calendarDownloadResponse(database.db, futureClock, fresh.token, past.id)).status).toBe(404);
    expect((await calendarDownloadResponse(database.db, futureClock, ownerToken, past.id)).status).toBe(401);
  });
});
