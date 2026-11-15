import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cancelAction, rescheduleAction } from '@/app/bookings/actions';
import { bookings, slots } from '@/db/schema';
import { createSession } from '@/server/auth/session';
import { bookSlot, type BookingDependencies } from '@/server/bookings/book';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { bookingForReview, cancellationReview, rescheduleReview } from '@/server/bookings/review';
import { isSlotFree } from '@/server/slots/queries';
import { seedClinic, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';

let database: TestDatabase;
let other: TestDatabase;
let active: TestDatabase;
let clinic: SeededClinic;
let otherClinic: SeededClinic;
let token = '';
let deps: BookingDependencies;
const clock = manualClock('2026-10-20T07:00:00Z');
const logs = captureLogs(clock);
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => (token ? { value: token } : undefined) }),
  headers: () => new Headers(),
}));
vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  getDatabase: () => active.db,
}));
vi.mock('@/lib/clock', async (original) => ({
  ...(await original<typeof import('@/lib/clock')>()),
  getClock: () => clock,
}));
vi.mock('@/lib/logger', async (original) => ({
  ...(await original<typeof import('@/lib/logger')>()),
  getLogger: () => logs.log,
}));
vi.mock('@/server/notifications/mailer', async (original) => ({
  ...(await original<typeof import('@/server/notifications/mailer')>()),
  getMailer: () => recordingMailer(),
}));
beforeAll(async () => {
  database = await startTestDatabase();
  other = await startTestDatabase();
});
afterAll(async () => {
  await Promise.allSettled([database?.stop(), other?.stop()]);
});
beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  await emptyDatabase(other.db);
  clinic = await seedClinic(database.db, clock, { settings: { slotHorizonDays: 4 } });
  otherClinic = await seedClinic(other.db, clock, {
    settings: { clinicName: 'Other Fictional Clinic', slotHorizonDays: 2 },
  });
  active = database;
  token = (await createSession(database.db, clock, clinic.patient1.id)).token;
  deps = { db: database.db, clock, log: logs.log, mail: testMail() };
});
async function slot(start: string) {
  const rows = await database.db.select().from(slots).where(eq(slots.practitionerId, clinic.practitioners.weekdays));
  const row = rows.find((row) => row.startsAt.toISOString() === start);
  if (!row) throw new Error('Missing fictional review slot');
  return row;
}
async function book(start = '2026-10-20T08:00:00.000Z', patientId = clinic.patient1.id) {
  return bookSlot(deps, { patientId, slotId: (await slot(start)).id });
}
function cancellationForm(id: string, expectedSlotId: string, late = true) {
  const form = new FormData();
  form.set('bookingId', id);
  form.set('expectedSlotId', expectedSlotId);
  form.set('expectedLate', String(late));
  return form;
}
function moveForm(id: string, expectedSlotId: string, target: string) {
  const form = new FormData();
  form.set('bookingId', id);
  form.set('expectedSlotId', expectedSlotId);
  form.set('newSlotId', target);
  return form;
}

it('reads current confirmation details without changing a booking or reserving the proposed time', async () => {
  const booking = await book();
  const target = await slot('2026-10-20T08:45:00.000Z');
  const before = await database.db.select().from(bookings);
  expect((await cancellationReview(database.db, clock, clinic.patient1.id, booking.id)).late).toBe(true);
  const move = await rescheduleReview(database.db, clock, clinic.patient1.id, booking.id, target.id);
  expect(move.booking.slotId).toBe(booking.slotId);
  expect(move.target.id).toBe(target.id);
  expect(await database.db.select().from(bookings)).toEqual(before);
  expect(await isSlotFree(database.db, target.id)).toBe(true);
});
it('saves a late cancellation before success, frees the time and refuses a repeat', async () => {
  const booking = await book();
  await expect(cancelAction(cancellationForm(booking.id, booking.slotId))).rejects.toThrow(
    'redirect:/bookings?notice=cancelled_late',
  );
  const [saved] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
  expect(saved).toMatchObject({ status: 'cancelled', lateCancellation: true, cancelledAt: clock.now() });
  expect(await isSlotFree(database.db, booking.slotId)).toBe(true);
  await expect(cancellationReview(database.db, clock, clinic.patient1.id, booking.id)).rejects.toMatchObject({
    code: 'booking_not_active',
  });
  await expect(cancelAction(cancellationForm(booking.id, booking.slotId))).rejects.toThrow('error=booking_not_active');
  expect((await database.db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]).toEqual(saved);
  expect((await book('2026-10-20T08:00:00.000Z', clinic.patient2.id)).status).toBe('confirmed');
});
it('saves an on-time cancellation without a late flag at the exact boundary', async () => {
  const booking = await book('2026-10-21T08:00:00.000Z');
  clock.set('2026-10-20T08:00:00Z');
  await expect(cancelAction(cancellationForm(booking.id, booking.slotId, false))).rejects.toThrow(
    'redirect:/bookings?notice=cancelled',
  );
  expect((await database.db.select().from(bookings))[0]).toMatchObject({
    status: 'cancelled',
    lateCancellation: false,
    cancelledAt: clock.now(),
  });
});
it('requires fresh review if a booking moves or the late-cancellation consequence changes', async () => {
  const booking = await book();
  const target = await slot('2026-10-20T08:45:00.000Z');
  await rescheduleBooking(deps, { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target.id });
  await expect(cancelAction(cancellationForm(booking.id, booking.slotId))).rejects.toThrow('error=booking_changed');
  await expect(
    rescheduleAction(moveForm(booking.id, booking.slotId, (await slot('2026-10-20T09:30:00.000Z')).id)),
  ).rejects.toThrow('error=booking_changed');
  expect((await database.db.select().from(bookings))[0]).toMatchObject({
    slotId: target.id,
    status: 'confirmed',
    rescheduleCount: 1,
  });
  const later = await book('2026-10-21T08:00:00.000Z');
  expect((await cancellationReview(database.db, clock, clinic.patient1.id, later.id)).late).toBe(false);
  clock.advanceMinutes(120);
  await expect(cancelAction(cancellationForm(later.id, later.slotId, false))).rejects.toThrow('error=booking_changed');
  expect((await database.db.select().from(bookings).where(eq(bookings.id, later.id)))[0]?.status).toBe('confirmed');
  expect((await cancellationReview(database.db, clock, clinic.patient1.id, later.id)).late).toBe(true);
});
it('preserves the original booking if a reviewed new time is taken before confirmation', async () => {
  const booking = await book();
  const target = await slot('2026-10-20T08:45:00.000Z');
  await rescheduleReview(database.db, clock, clinic.patient1.id, booking.id, target.id);
  await book('2026-10-20T08:45:00.000Z', clinic.patient2.id);
  await expect(rescheduleAction(moveForm(booking.id, booking.slotId, target.id))).rejects.toThrow(
    'error=slot_unavailable',
  );
  expect((await database.db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]).toMatchObject({
    slotId: booking.slotId,
    status: 'confirmed',
    rescheduleCount: 0,
  });
  expect(await isSlotFree(database.db, booking.slotId)).toBe(false);
});
it('refuses started bookings and submissions without reviewed details', async () => {
  const booking = await book();
  const empty = new FormData();
  empty.set('bookingId', booking.id);
  await expect(cancelAction(empty)).rejects.toThrow('error=review_required');
  await expect(rescheduleAction(empty)).rejects.toThrow('error=review_required');
  clock.set(booking.startsAt);
  await expect(cancelAction(cancellationForm(booking.id, booking.slotId))).rejects.toThrow(
    'error=booking_already_started',
  );
  expect((await database.db.select().from(bookings))[0]?.status).toBe('confirmed');
});
it('refuses other clients, staff, expired and foreign sessions on confirmation submissions', async () => {
  const booking = await book();
  const target = await slot('2026-10-20T08:45:00.000Z');
  const client = (await createSession(database.db, clock, clinic.patient2.id)).token;
  const admin = (await createSession(database.db, clock, clinic.admin.id)).token;
  const foreign = (await createSession(other.db, clock, otherClinic.patient1.id)).token;
  const expired = (await createSession(database.db, manualClock('2026-10-19T07:00:00Z'), clinic.patient1.id)).token;
  const before = await database.db.select().from(bookings);
  for (const candidate of ['', 'forged', expired, foreign, client, admin]) {
    token = candidate;
    const error =
      candidate === client ? 'error=booking_not_found' : candidate === admin ? 'redirect:/' : 'redirect:/auth/sign-in';
    await expect(cancelAction(cancellationForm(booking.id, booking.slotId))).rejects.toThrow(error);
    await expect(rescheduleAction(moveForm(booking.id, booking.slotId, target.id))).rejects.toThrow(error);
    expect(await database.db.select().from(bookings)).toEqual(before);
  }
  await expect(bookingForReview(database.db, clinic.patient2.id, booking.id)).rejects.toMatchObject({
    code: 'booking_not_found',
  });
  await expect(bookingForReview(other.db, otherClinic.patient1.id, booking.id)).rejects.toMatchObject({
    code: 'booking_not_found',
  });
  active = other;
  token = (await createSession(database.db, clock, clinic.patient1.id)).token;
  await expect(cancelAction(cancellationForm(booking.id, booking.slotId))).rejects.toThrow('redirect:/auth/sign-in');
});
