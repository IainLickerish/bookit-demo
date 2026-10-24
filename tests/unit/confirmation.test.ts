import { describe, expect, it } from 'vitest';
import type { BookingView } from '@/server/bookings/queries';
import { composeConfirmation, formatPhone } from '@/server/notifications/confirmation';
import { deliverEmail } from '@/server/notifications/deliver';
import {
  assertTestAddress,
  disabledMailer,
  EmailAddressRefusedError,
  type Mailer,
} from '@/server/notifications/mailer';
import type { ClinicSettings } from '@/server/settings';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, TEST_MAIL_FROM, testMail } from '../helpers/mail';

const settings: ClinicSettings = {
  clinicName: 'Test Physio Clinic',
  timeZone: 'Europe/London',
  lateCancellationHours: 24,
  includeContactInConfirmation: true,
  slotHorizonDays: 220,
  sessionMinutes: 45,
  maxReschedulesPerBooking: 3,
};

const patient = { email: 'patient1@patients.example.test', name: 'Pat One' };

function booking(phone: string | null): BookingView {
  return {
    id: '019a0000-0000-7000-8000-00000000b001',
    patientId: '019a0000-0000-7000-8000-00000000a001',
    status: 'confirmed',
    lateCancellation: false,
    phone,
    rescheduleCount: 0,
    createdAt: new Date('2026-10-20T07:00:00Z'),
    updatedAt: new Date('2026-10-20T07:00:00Z'),
    cancelledAt: null,
    slotId: '019a0000-0000-7000-8000-00000000c001',
    startsAt: new Date('2026-10-22T09:30:00Z'),
    endsAt: new Date('2026-10-22T10:15:00Z'),
    practitionerId: '019a0000-0000-7000-8000-00000000d001',
    practitionerName: 'Pat Physio',
  };
}

describe('confirmation email (REQ-18.1-01, plan 12.1)', () => {
  it('confirms the slot in the clinic time zone with the practitioner and booking reference', () => {
    const email = composeConfirmation({ booking: booking('+44 7700 900001'), patient, settings, from: TEST_MAIL_FROM });
    expect(email.from).toBe(TEST_MAIL_FROM);
    expect(email.to).toBe(patient.email);
    expect(email.subject).toBe('Booking confirmed: Thu, 22 Oct 2026, 10:30');
    expect(email.text).toContain('Dear Pat One,');
    expect(email.text).toContain('Your appointment at Test Physio Clinic is confirmed.');
    expect(email.text).toContain('When: Thu, 22 Oct 2026, 10:30 (Europe/London)');
    expect(email.text).toContain('With: Pat Physio');
    expect(email.text).toContain('Booking reference: 019a0000-0000-7000-8000-00000000b001');
  });

  it('includes the contact phone when the clinic asks for it and the patient gave one', () => {
    const email = composeConfirmation({
      booking: booking('+44  7700 900001'),
      patient,
      settings,
      from: TEST_MAIL_FROM,
    });
    expect(email.text).toContain('Contact phone: +44 7700 900001\n');
  });

  it('leaves the phone line out with no phone when contact collection is disabled', () => {
    const email = composeConfirmation({
      booking: booking(null),
      patient,
      settings: { ...settings, includeContactInConfirmation: false },
      from: TEST_MAIL_FROM,
    });
    expect(email.text).not.toContain('Contact phone');
  });

  it('leaves the phone line out when the clinic turns contact details off', () => {
    const email = composeConfirmation({
      booking: booking('+44 7700 900001'),
      patient,
      settings: { ...settings, includeContactInConfirmation: false },
      from: TEST_MAIL_FROM,
    });
    expect(email.text).not.toContain('7700');
  });

  it('formats a stored phone by collapsing whitespace', () => {
    expect(formatPhone(' +44 7700\t900001 ')).toBe('+44 7700 900001');
  });
});

describe('sending confirmations (REQ-18.1-01; brief 18: no real email)', () => {
  it('only ever sends from and to .test domains', () => {
    expect(() => assertTestAddress('noreply@acmephysio.test', 'sender')).not.toThrow();
    expect(() => assertTestAddress('patient1@patients.beacondental.test', 'recipient')).not.toThrow();
    for (const address of ['someone@example.com', 'a@b.test.com', 'x@test', 'Name <a@b.test>', '']) {
      expect(() => assertTestAddress(address, 'recipient')).toThrow(EmailAddressRefusedError);
    }
  });

  it('logs a sent confirmation with a hashed recipient and no address or phone', async () => {
    const clock = manualClock('2026-10-20T07:00:00Z');
    const logs = captureLogs(clock);
    const mailer = recordingMailer();
    const email = composeConfirmation({ booking: booking('+44 7700 900001'), patient, settings, from: TEST_MAIL_FROM });
    expect(await deliverEmail(testMail(mailer), logs.log, email, 'confirmation', { booking_id: 'b-1' })).toBe(true);
    expect(mailer.sent).toEqual([email]);
    expect(logs.lines).toEqual([
      expect.objectContaining({
        event: 'email.confirmation.sent',
        booking_id: 'b-1',
        recipient_hash: expect.stringMatching(/^[0-9a-f]{16}$/),
        mailer: 'recording',
      }),
    ]);
    expect(JSON.stringify(logs.lines)).not.toMatch(/example\.test|7700/);
  });

  it('logs and returns false when sending fails, without throwing', async () => {
    const logs = captureLogs(manualClock('2026-10-20T07:00:00Z'));
    const failing: Mailer = {
      kind: 'smtp',
      send: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1025')),
    };
    const email = composeConfirmation({ booking: booking('+44 7700 900001'), patient, settings, from: TEST_MAIL_FROM });
    expect(await deliverEmail(testMail(failing), logs.log, email, 'confirmation', { booking_id: 'b-2' })).toBe(false);
    expect(logs.lines).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'email.confirmation.failed',
        booking_id: 'b-2',
        error_name: 'Error',
      }),
    ]);
  });

  it('sends nothing without an SMTP server, but still refuses non-.test addresses', async () => {
    const logs = captureLogs(manualClock('2026-10-20T07:00:00Z'));
    const email = composeConfirmation({ booking: booking('+44 7700 900001'), patient, settings, from: TEST_MAIL_FROM });
    expect(await deliverEmail(testMail(disabledMailer), logs.log, email, 'confirmation', { booking_id: 'b-3' })).toBe(
      true,
    );
    expect(logs.lines[0]).toMatchObject({ event: 'email.confirmation.sent', mailer: 'disabled', message_id: null });
    await expect(disabledMailer.send({ ...email, to: 'someone@example.com' })).rejects.toThrow(
      EmailAddressRefusedError,
    );
  });
});
