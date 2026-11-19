import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings } from '@/db/schema';
import { formatLocalTime, localDateOf } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { createSmtpMailer } from '@/server/notifications/mailer';
import { createUser } from '@/server/users';
import { saveClinicSettings } from '@/server/settings';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { startSmtpReceiver, TEST_MAIL_FROM, type SmtpReceiver } from '../helpers/mail';

const EVIDENCE_DIR = path.resolve(import.meta.dirname, '../../test-results/m0-24c');

let database: TestDatabase;
let smtp: SmtpReceiver;
let clinic: SeededClinic;
let logs: CapturedLogs;
const clock = manualClock('2026-10-20T07:00:00Z');

async function freeSlotId(
  index = 0,
  date = '2026-10-22',
  practitionerId = clinic.practitioners.weekdays,
): Promise<string> {
  const slots = await listAvailableSlots(database.db, {
    practitionerId,
    after: clock.now(),
    until: new Date('2026-11-30T00:00:00Z'),
  });
  const slot = slots.filter((s) => localDateOf(s.startsAt, 'Europe/London') === date)[index];
  if (!slot) {
    throw new Error(`No free slot on ${date}`);
  }
  return slot.id;
}

function deps(smtpUrl = smtp.url) {
  return { db: database.db, clock, log: logs.log, mail: { mailer: createSmtpMailer(smtpUrl), from: TEST_MAIL_FROM } };
}

/** The decoded text body of a received message (nodemailer uses quoted-printable for long lines). */
function bodyOf(raw: string): string {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const body = headerEnd === -1 ? raw : raw.slice(headerEnd);
  return body
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function calendarAttachment(raw: string): string {
  const parts = raw.split(/\r\n--[^\r\n]+\r\n/);
  const calendar = parts.find((part) => part.startsWith('Content-Type: text/calendar;'));
  expect(calendar).toBeDefined();
  const [headers, content] = calendar!.split('\r\n\r\n', 2);
  expect(headers).toContain('Content-Disposition: attachment; filename=physio-session.ics');
  expect(headers).toContain('Content-Transfer-Encoding: base64');
  return Buffer.from(content!, 'base64').toString('utf8');
}

function recordEvidence(name: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(data)}`);
}

beforeAll(async () => {
  database = await startTestDatabase(5);
  smtp = await startSmtpReceiver();
});

afterAll(async () => {
  await smtp.stop();
  await database.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  smtp.messages.length = 0;
  clinic = await seedClinic(database.db, clock);
  logs = captureLogs(clock);
});

describe('confirmation emails through SMTP (REQ-18.1-01, plan 12.1; Mailpit stand-in, no real email)', () => {
  it('attaches a calendar file to both confirmations with the correct session details after a move', async () => {
    await saveClinicSettings(database.db, clock, {
      ...clinic.settings,
      clinicName: 'Acme Physio',
      timeZone: 'Pacific/Honolulu',
    });
    const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: await freeSlotId() });
    const target = await freeSlotId(0, '2026-10-29', clinic.practitioners.saturdays);
    await rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target });

    expect(smtp.messages.map((message) => message.to)).toEqual([[clinic.patient1.email], [clinic.patient1.email]]);
    const [first, second] = smtp.messages.map((message) => calendarAttachment(message.raw));
    expect(first).toContain('SUMMARY:Acme Physio session with Pat Physio\r\n');
    expect(first).toContain('DTSTART:20261022T080000Z\r\nDTEND:20261022T084500Z\r\n');
    expect(first?.replace(/\r\n /g, '')).toContain('Thu\\, 22 Oct 2026\\, 09:00 (Europe/London)\\n45 minutes');
    expect(second).toContain('SUMMARY:Acme Physio session with Sam Sports\r\n');
    expect(second).toContain('DTSTART:20261029T100000Z\r\nDTEND:20261029T104500Z\r\n');
    expect(second?.replace(/\r\n /g, '')).toContain('Thu\\, 29 Oct 2026\\, 10:00 (Europe/London)\\n45 minutes');
    expect(first).toContain(`UID:${booking.id}@bookit.test\r\n`);
    expect(second).toContain(`UID:${booking.id}@bookit.test\r\n`);
    expect(second).toContain('SEQUENCE:1\r\n');
    expect(bodyOf(smtp.messages[1]!.raw)).toContain('Your session at Acme Physio has been rescheduled.');

    await expect(
      rescheduleBooking(deps(), { patientId: clinic.patient1.id, bookingId: booking.id, newSlotId: target }),
    ).rejects.toMatchObject({ code: 'same_slot' });
    expect(smtp.messages).toHaveLength(2);
  });

  it('keeps the new session time when the move email cannot be sent', async () => {
    const booking = await bookSlot(deps(), { patientId: clinic.patient1.id, slotId: await freeSlotId() });
    const target = await freeSlotId();
    await rescheduleBooking(deps('smtp://127.0.0.1:9'), {
      patientId: clinic.patient1.id,
      bookingId: booking.id,
      newSlotId: target,
    });

    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row).toMatchObject({ status: 'confirmed', slotId: target });
    expect(smtp.messages).toHaveLength(1);
    expect(logs.events()).toContain('email.confirmation.failed');
  });

  it('sends one confirmation with the contact phone when the clinic includes contact details', async () => {
    await saveClinicSettings(database.db, clock, { ...clinic.settings, includeContactInConfirmation: true });
    const booking = await bookSlot(deps(), {
      patientId: clinic.patient1.id,
      slotId: await freeSlotId(),
      phone: '+44 7700 900001',
    });
    expect(smtp.messages).toHaveLength(1);
    const [message] = smtp.messages;
    expect(message!.from).toBe(TEST_MAIL_FROM);
    expect(message!.to).toEqual([clinic.patient1.email]);
    const body = bodyOf(message!.raw);
    expect(body).toContain(`Booking reference: ${booking.id}`);
    expect(body).toContain(
      `When: Thu, 22 Oct 2026, ${formatLocalTime(booking.startsAt, 'Europe/London')} (Europe/London)`,
    );
    expect(body).toContain('Contact phone: +44 7700 900001');
    const sent = logs.lines.find((l) => l.event === 'email.confirmation.sent');
    expect(sent).toMatchObject({ booking_id: booking.id, mailer: 'smtp', recipient_hash: expect.any(String) });
    expect(JSON.stringify(logs.lines)).not.toMatch(/patients\.example\.test|7700/);
    recordEvidence('confirmation-email-with-phone', {
      bookingId: booking.id,
      envelope: { from: message!.from, toCount: message!.to.length },
      containsPhoneLine: body.includes('Contact phone:'),
      logEvents: logs.events(),
    });
  });

  it('books without a phone when contact collection is disabled, without a phone line', async () => {
    const booking = await bookSlot(deps(), { patientId: clinic.patient2.id, slotId: await freeSlotId() });
    expect(booking.status).toBe('confirmed');
    expect(smtp.messages).toHaveLength(1);
    expect(bodyOf(smtp.messages[0]!.raw)).not.toContain('Contact phone');
    recordEvidence('confirmation-email-without-phone', {
      bookingId: booking.id,
      status: booking.status,
      containsPhoneLine: bodyOf(smtp.messages[0]!.raw).includes('Contact phone:'),
    });
  });

  it('keeps the booking when the SMTP server is down, and logs the failure', async () => {
    const booking = await bookSlot(deps('smtp://127.0.0.1:9'), {
      patientId: clinic.patient1.id,
      slotId: await freeSlotId(),
    });
    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.status).toBe('confirmed');
    expect(logs.events()).toEqual(['booking.confirmed', 'email.confirmation.failed']);
    expect(smtp.messages).toHaveLength(0);
  });

  it('refuses to email a patient whose address is not on a .test domain, and keeps the booking', async () => {
    const outsider = await createUser(database.db, clock, {
      email: 'someone@example.com',
      name: 'Outside Address',
      role: 'patient',
      password: TEST_PASSWORD,
    });
    const booking = await bookSlot(deps(), { patientId: outsider.id, slotId: await freeSlotId(1) });
    expect(booking.status).toBe('confirmed');
    expect(smtp.messages).toHaveLength(0);
    expect(logs.lines.find((l) => l.event === 'email.confirmation.failed')).toMatchObject({
      error_name: 'EmailAddressRefusedError',
    });
  });
});
