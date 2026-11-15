import { describe, expect, it } from 'vitest';
import type { BookingView } from '@/server/bookings/queries';
import { composeReminder, reminderIsDue } from '@/server/notifications/reminder';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';
import { TEST_MAIL_FROM } from '../helpers/mail';

const booking: BookingView = {
  id: '019a0000-0000-7000-8000-00000000b001',
  patientId: '019a0000-0000-7000-8000-00000000a001',
  status: 'confirmed',
  lateCancellation: false,
  phone: null,
  rescheduleCount: 0,
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  slotId: '019a0000-0000-7000-8000-00000000c001',
  startsAt: new Date('2026-10-26T10:30:00Z'),
  endsAt: new Date('2026-10-26T11:15:00Z'),
  practitionerId: '019a0000-0000-7000-8000-00000000d001',
  practitionerName: 'Pat Physio',
};

const input = {
  booking,
  patient: { email: 'reminder@patients.example.test', name: 'Reminder Client' },
  settings: TEST_CLINIC_SETTINGS,
  from: TEST_MAIL_FROM,
  publicUrl: new URL('https://clinic.example.test'),
  tenant: 'acme',
};

describe('reminder timing and content', () => {
  it.each([
    ['2026-10-26T10:30:00Z', '2026-10-25T10:29:59Z', false],
    ['2026-10-26T10:30:00Z', '2026-10-25T10:30:00Z', true],
    ['2026-10-26T10:30:00Z', '2026-10-26T10:29:59Z', true],
    ['2026-10-26T10:30:00Z', '2026-10-26T10:30:00Z', false],
    ['2026-10-26T10:30:00Z', '2026-10-26T10:30:01Z', false],
    // Exactly 24 elapsed hours across each clock change, rather than a local calendar day.
    ['2026-10-25T09:00:00Z', '2026-10-24T09:00:00Z', true],
    ['2027-03-28T08:00:00Z', '2027-03-27T08:00:00Z', true],
    ['2026-10-25T09:00:00Z', '2026-10-24T08:59:59Z', false],
  ])('decides whether %s is due at %s', (start, now, expected) => {
    expect(reminderIsDue(new Date(start), new Date(now))).toBe(expected);
  });

  it.each([
    ['2026-10-24T09:30:00Z', 'Sat, 24 Oct 2026, 10:30'],
    ['2026-10-26T10:30:00Z', 'Mon, 26 Oct 2026, 10:30'],
  ])('shows UK time for %s, including if the clinic display zone changes', (start, when) => {
    const email = composeReminder({
      ...input,
      booking: { ...booking, startsAt: new Date(start) },
      settings: { ...input.settings, timeZone: 'Europe/Paris' },
    });
    expect(email.subject).toBe(`Booking reminder: ${when}`);
    expect(email.text.startsWith(`${input.settings.clinicName}\n`)).toBe(true);
    expect(email.text).toContain(`When: ${when} (UK time, Europe/London)`);
    expect(email.text).toContain('With: Pat Physio, your physiotherapist');
    expect(email.text).toContain('your session');
    expect(email.to).toBe(input.patient.email);
    expect(email.from).toBe(TEST_MAIL_FROM);
    expect(email.text).not.toContain('Contact phone');
    expect(email.text).toContain(`Reschedule: https://clinic.example.test/bookings/${booking.id}/reschedule`);
    expect(email.text).toContain(`Cancel in My bookings: https://clinic.example.test/bookings#booking-${booking.id}`);
    expect(email.text).toContain('Sign in with your clinic account');
    expect(email.text).not.toContain('token');
  });

  it('uses Beacon wording and its configured origin', () => {
    const email = composeReminder({ ...input, tenant: 'beacon', publicUrl: new URL('https://beacon.example.test') });
    expect(email.text).toContain('your appointment');
    expect(email.text).toContain('your clinician');
    expect(email.text).not.toContain('physiotherapist');
    expect(email.text).toContain(`https://beacon.example.test/bookings/${booking.id}/reschedule`);
  });
});
