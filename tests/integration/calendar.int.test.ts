import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { bookingCalendarResponse } from '@/server/bookings/calendar-response';
import { bookingCalendar } from '@/server/bookings/calendar';
import { createSession } from '@/server/auth/session';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

let database: TestDatabase;
let foreignDatabase: TestDatabase;
let clinic: SeededClinic;
let foreignClinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');

beforeAll(async () => {
  database = await startTestDatabase();
  foreignDatabase = await startTestDatabase();
  clinic = await seedClinic(database.db, clock);
  foreignClinic = await seedClinic(foreignDatabase.db, clock, {
    settings: { clinicName: 'Beacon Dental', sessionMinutes: 30 },
  });
});

afterAll(async () => {
  await database?.stop();
  await foreignDatabase?.stop();
});

describe('private client calendar download', () => {
  it('serves only the signed-in owner and refuses all other sessions, clinics and unavailable bookings', async () => {
    const deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
    const slots = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.weekdays,
      after: new Date('2026-10-22T00:00:00Z'),
      until: new Date('2026-10-23T00:00:00Z'),
    });
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slots[0]!.id });
    const owner = await createSession(database.db, clock, clinic.patient1.id);
    const stranger = await createSession(database.db, clock, clinic.patient2.id);
    const staff = await createSession(database.db, clock, clinic.admin.id);
    const response = await bookingCalendarResponse(deps, owner.token, booking.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="booking.ics"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe(bookingCalendar(booking, clinic.settings));

    for (const token of [undefined, 'invalid-session', stranger.token, staff.token]) {
      const denied = await bookingCalendarResponse(deps, token, booking.id);
      expect(denied.status).toBe(404);
      expect(await denied.text()).not.toMatch(/Pat Physio|DTSTART|Patient One/);
      expect(denied.headers.get('Cache-Control')).toBe('private, no-store');
    }
    for (const id of ['invalid-id', '019a0000-0000-7000-8000-000000000000']) {
      expect((await bookingCalendarResponse(deps, owner.token, id)).status).toBe(404);
    }
    expect((await bookingCalendarResponse({ ...deps, db: foreignDatabase.db }, owner.token, booking.id)).status).toBe(
      404,
    );

    const foreignDeps = { ...deps, db: foreignDatabase.db };
    const foreignSlots = await listAvailableSlots(foreignDatabase.db, {
      practitionerId: foreignClinic.practitioners.weekdays,
      after: new Date('2026-10-22T00:00:00Z'),
      until: new Date('2026-10-23T00:00:00Z'),
    });
    const foreignBooking = await bookSlot(foreignDeps, {
      patientId: foreignClinic.patient1.id,
      slotId: foreignSlots[0]!.id,
    });
    const foreignOwner = await createSession(foreignDatabase.db, clock, foreignClinic.patient1.id);
    expect((await bookingCalendarResponse(foreignDeps, foreignOwner.token, booking.id)).status).toBe(404);
    expect((await bookingCalendarResponse(deps, owner.token, foreignBooking.id)).status).toBe(404);
    const foreignFile = await bookingCalendarResponse(foreignDeps, foreignOwner.token, foreignBooking.id);
    expect(foreignFile.status).toBe(200);
    const foreignText = (await foreignFile.text()).replace(/\r\n /g, '');
    expect(foreignText).toContain('SUMMARY:Beacon Dental with Pat Physio\r\n');
    expect(foreignText).toContain('Duration: 30 minutes');

    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect((await bookingCalendarResponse(deps, owner.token, booking.id)).status).toBe(404);
    const past = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slots[1]!.id });
    clock.set(past.endsAt.toISOString());
    const renewed = await createSession(database.db, clock, clinic.patient1.id);
    expect((await bookingCalendarResponse(deps, renewed.token, past.id)).status).toBe(404);
    expect((await bookingCalendarResponse(deps, owner.token, past.id)).status).toBe(404);
  });
});
