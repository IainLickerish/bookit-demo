import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '@/server/auth/session';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { bookingCalendarResponse } from '@/server/bookings/calendar-http';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer } from '@/server/notifications/mailer';
import { saveClinicSettings } from '@/server/settings';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { startSmtpReceiver, TEST_MAIL_FROM, type SmtpReceiver } from '../helpers/mail';

let database: TestDatabase;
let smtp: SmtpReceiver;
let clinic: SeededClinic;
let deps: BookingDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');

beforeAll(async () => {
  database = await startTestDatabase();
  smtp = await startSmtpReceiver();
});
afterAll(async () => {
  await smtp?.stop();
  await database?.stop();
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  smtp.messages.length = 0;
  deps = {
    db: database.db,
    clock,
    log: captureLogs(clock).log,
    mail: { mailer: createSmtpMailer(smtp.url), from: TEST_MAIL_FROM },
  };
});

async function slotOn(day: string, practitionerId = clinic.practitioners.weekdays) {
  const slots = await listAvailableSlots(database.db, {
    practitionerId,
    after: new Date(`${day}T00:00:00Z`),
    until: new Date(`${day}T23:59:59Z`),
  });
  return slots[0]!;
}

/** Decode the actual MIME attachment delivered over SMTP, rather than the input to the mailer. */
function attachment(raw: string): string {
  const part = raw.split(/\r\n(?=Content-Type:)/i).find((value) => /filename="?booking\.ics"?/i.test(value));
  expect(part).toBeDefined();
  expect(part).toMatch(/Content-Type: text\/calendar;.*method=PUBLISH/i);
  expect(part).toMatch(/Content-Transfer-Encoding: base64/i);
  const content = part!.split('\r\n\r\n')[1]!.split('\r\n--')[0]!;
  return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8').replace(/\r\n /g, '');
}

describe('private booking calendars and confirmation attachments', () => {
  it.each([
    { clinicName: 'Acme Physio', minutes: 45 },
    { clinicName: 'Beacon Dental', minutes: 30 },
  ])(
    'emails the saved clinic, practitioner, UK time and length after booking and moving at $clinicName',
    async ({ clinicName, minutes }) => {
      await emptyDatabase(database.db);
      clinic = await seedClinic(database.db, clock, { settings: { clinicName, sessionMinutes: minutes } });
      const original = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: (await slotOn('2026-10-22')).id });
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]!.to).toEqual([clinic.patient1.email]);
      const first = attachment(smtp.messages[0]!.raw);
      expect(first).toContain(`SUMMARY:${clinicName} with Pat Physio\r\n`);
      expect(first).toContain(`LOCATION:${clinicName}\r\n`);
      expect(first).toContain('DTSTART:20261022T080000Z\r\n');
      expect(first).toContain(`DTEND:20261022T08${minutes}00Z\r\n`);
      expect(first).toContain(`Thu\\, 22 Oct 2026\\, 09:00 (Europe/London)\\nLength: ${minutes} minutes`);
      // Existing slots keep their saved length even if the clinic changes its default.
      await saveClinicSettings(database.db, clock, { ...clinic.settings, sessionMinutes: 90 });
      clock.advanceMinutes(5);
      const moved = await rescheduleBooking(deps, {
        patientId: clinic.patient1.id,
        bookingId: original.id,
        newSlotId: (await slotOn('2026-10-27', clinic.practitioners.saturdays)).id,
      });
      expect(smtp.messages).toHaveLength(2);
      expect(smtp.messages[1]!.to).toEqual([clinic.patient1.email]);
      const second = attachment(smtp.messages[1]!.raw);
      expect(second).toContain(`SUMMARY:${clinicName} with Sam Sports\r\n`);
      expect(second).toContain('DTSTART:20261027T100000Z\r\n');
      expect(second).toContain(`DTEND:20261027T10${minutes}00Z\r\n`);
      expect(second).toContain(`Tue\\, 27 Oct 2026\\, 10:00 (Europe/London)\\nLength: ${minutes} minutes`);
      expect(second).toContain('SEQUENCE:1\r\n');
      expect(first.match(/UID:[^\r]+/)?.[0]).toBe(second.match(/UID:[^\r]+/)?.[0]);
      expect(await findBookingForPatient(database.db, clinic.patient1.id, original.id)).toMatchObject({
        slotId: moved.slotId,
      });
      const session = await createSession(database.db, clock, clinic.patient1.id);
      const download = await bookingCalendarResponse(deps, session.token, original.id);
      expect(download.status).toBe(200);
      expect((await download.text()).replace(/\r\n /g, '')).toBe(second);
    },
  );

  it('only lets the signed-in owner download an upcoming confirmed booking', async () => {
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: (await slotOn('2026-10-22')).id });
    const owner = await createSession(database.db, clock, clinic.patient1.id);
    const other = await createSession(database.db, clock, clinic.patient2.id);
    const admin = await createSession(database.db, clock, clinic.admin.id);
    for (const [token, id, status] of [
      [undefined, booking.id, 401],
      ['forged', booking.id, 401],
      [other.token, booking.id, 404],
      [admin.token, booking.id, 403],
      [owner.token, 'invalid', 404],
    ] as const) {
      const response = await bookingCalendarResponse(deps, token, id);
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await response.text()).not.toContain('BEGIN:VCALENDAR');
    }
    const response = await bookingCalendarResponse(deps, owner.token, booking.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="booking.ics"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await cancelBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id });
    expect((await bookingCalendarResponse(deps, owner.token, booking.id)).status).toBe(404);
    const second = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: (await slotOn('2026-10-23')).id });
    clock.set(second.startsAt.toISOString());
    const renewed = await createSession(database.db, clock, clinic.patient1.id);
    expect((await bookingCalendarResponse(deps, renewed.token, second.id)).status).toBe(404);
  });

  it('keeps a moved booking if email delivery fails and sends nothing for a refused move', async () => {
    const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: (await slotOn('2026-10-22')).id });
    await expect(
      rescheduleBooking(deps, {
        patientId: clinic.patient2.id,
        bookingId: booking.id,
        newSlotId: (await slotOn('2026-10-23')).id,
      }),
    ).rejects.toMatchObject({ code: 'booking_not_found' });
    expect(smtp.messages).toHaveLength(1);
    const target = await slotOn('2026-10-23');
    const failing = { ...deps, mail: { mailer: createSmtpMailer('smtp://127.0.0.1:9'), from: TEST_MAIL_FROM } };
    const moved = await rescheduleBooking(failing, {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target.id,
    });
    expect(moved.slotId).toBe(target.id);
    expect(await findBookingForPatient(database.db, clinic.patient1.id, booking.id)).toMatchObject({
      slotId: target.id,
    });
    expect(smtp.messages).toHaveLength(1);
  });
});
