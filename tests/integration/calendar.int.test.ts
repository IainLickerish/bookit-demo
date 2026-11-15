import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createSession } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { findBookingForPatient } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import * as calendar from '@/server/calendar/appointment';
import { calendarResponse } from '@/server/calendar/http';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

let database: TestDatabase;
let clinic: SeededClinic;
const clock = manualClock('2026-10-20T07:00:00Z');
const logs = captureLogs(clock);
const mailer = recordingMailer();
const deps = () => ({ db: database.db, clock, log: logs.log, mail: testMail(mailer) });

beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  mailer.sent.length = 0;
});

async function twoSlots() {
  const slots = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: new Date('2026-10-22T00:00:00Z'),
    until: new Date('2026-10-23T00:00:00Z'),
  });
  return [slots[0]!, slots[1]!] as const;
}

it('downloads only a signed-in patient’s own confirmed booking with private response headers', async () => {
  const [slot] = await twoSlots();
  const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: slot.id });
  const owner = await createSession(database.db, clock, clinic.patient1.id);
  const other = await createSession(database.db, clock, clinic.patient2.id);
  const staff = await createSession(database.db, clock, clinic.admin.id);
  for (const [token, id, status] of [
    [undefined, booking.id, 401],
    ['invalid-token', booking.id, 401],
    [other.token, booking.id, 404],
    [staff.token, booking.id, 403],
    [owner.token, 'not-a-booking', 404],
  ] as const) {
    const result = await calendarResponse(deps(), token, id);
    expect(result.status).toBe(status);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(await result.text()).not.toContain('BEGIN:VCALENDAR');
  }
  const result = await calendarResponse(deps(), owner.token, booking.id);
  expect(result.status).toBe(200);
  expect(result.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(result.headers.get('content-disposition')).toContain('attachment; filename="appointment.ics"');
  expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await result.text()).toBe(calendar.appointmentCalendar(booking, clinic.settings));
  await cancelBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id });
  const cancelled = await calendarResponse(deps(), owner.token, booking.id);
  expect(cancelled.status).toBe(404);
  expect(await cancelled.text()).not.toContain('BEGIN:VCALENDAR');
});

it('booking and move attachments match the saved booking and the current downloadable calendar', async () => {
  const [original, target] = await twoSlots();
  const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original.id });
  expect(mailer.sent[0]?.attachments?.[0]?.content).toBe(calendar.appointmentCalendar(booking, clinic.settings));
  const moved = await rescheduleBooking(deps(), {
    patientId: clinic.patient1.id,
    bookingId: booking.id,
    newSlotId: target.id,
  });
  const saved = await findBookingForPatient(database.db, clinic.patient1.id, booking.id);
  expect(saved?.slotId).toBe(target.id);
  expect(mailer.sent).toHaveLength(2);
  expect(mailer.sent[1]?.to).toBe(clinic.patient1.email);
  expect(mailer.sent[1]?.subject).toContain('rescheduled');
  const session = await createSession(database.db, clock, clinic.patient1.id);
  const result = await calendarResponse(deps(), session.token, booking.id);
  expect(await result.text()).toBe(mailer.sent[1]?.attachments?.[0]?.content);
  expect(mailer.sent[1]?.attachments?.[0]?.content).toBe(calendar.appointmentCalendar(moved, clinic.settings));
  expect(mailer.sent[1]?.attachments?.[0]?.content).not.toBe(mailer.sent[0]?.attachments?.[0]?.content);
});

it('calendar generation failures leave newly booked and moved appointments saved', async () => {
  const [original, target] = await twoSlots();
  vi.spyOn(calendar, 'appointmentCalendar').mockImplementation(() => {
    throw new Error('Calendar unavailable');
  });
  const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original.id });
  expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.slotId).toBe(original.id);
  await rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target.id });
  expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.slotId).toBe(target.id);
  const session = await createSession(database.db, clock, clinic.patient1.id);
  const response = await calendarResponse(deps(), session.token, booking.id);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/bookings?error=calendar_unavailable');
  expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.status).toBe('confirmed');
});

it('a move stays saved if email delivery fails', async () => {
  const [original, target] = await twoSlots();
  const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: original.id });
  const failing = {
    ...deps(),
    mail: testMail({ kind: 'recording', send: () => Promise.reject(new Error('Mail unavailable')) }),
  };
  const moved = await rescheduleBooking(failing, {
    patientId: clinic.patient1.id,
    bookingId: booking.id,
    newSlotId: target.id,
  });
  expect(moved.slotId).toBe(target.id);
  expect((await findBookingForPatient(database.db, clinic.patient1.id, booking.id))?.slotId).toBe(target.id);
});
