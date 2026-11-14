import { describe, expect, it } from 'vitest';
import { bookingReturnPath } from '@/lib/routes';
import type { BookingView } from '@/server/bookings/queries';
import { composeReminder, reminderDue } from '@/server/notifications/reminder';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

const booking: BookingView = {
  id: '019a0000-0000-7000-8000-00000000b001',
  patientId: '019a0000-0000-7000-8000-00000000a001',
  slotId: '019a0000-0000-7000-8000-00000000c001',
  practitionerId: '019a0000-0000-7000-8000-00000000d001',
  practitionerName: 'Alex Example',
  status: 'confirmed',
  lateCancellation: false,
  phone: '+44 7700 900001',
  rescheduleCount: 0,
  startsAt: new Date('2026-10-25T09:00:00Z'),
  endsAt: new Date('2026-10-25T09:45:00Z'),
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
};

describe('reminder timing and content', () => {
  it.each([
    ['2026-10-24T08:59:59.999Z', false],
    ['2026-10-24T09:00:00Z', true],
    ['2026-10-24T09:30:00Z', true],
    ['2026-10-24T10:00:00Z', true],
    ['2026-10-24T10:00:00.001Z', false],
    ['2026-10-25T09:00:00Z', false],
  ])('uses elapsed hours across the autumn clock change at %s', (now, due) => {
    expect(reminderDue(booking.startsAt, new Date(now))).toBe(due);
  });
  it('uses elapsed hours across the spring clock change', () => {
    const start = new Date('2027-03-28T08:00:00Z');
    expect(reminderDue(start, new Date('2027-03-27T08:00:00Z'))).toBe(true);
    expect(reminderDue(start, new Date('2027-03-27T07:59:59Z'))).toBe(false);
    expect(reminderDue(start, new Date('2027-03-27T09:00:01Z'))).toBe(false);
  });
  it.each([
    ['acme', 'Acme Physio', 'session', 'physiotherapist'],
    ['beacon', 'Beacon Dental', 'appointment', 'clinician'],
  ])(
    'shows %s details, UK time, actual duration and safe change links without phone data',
    (tenant, clinicName, noun, practitioner) => {
      const email = composeReminder({
        booking,
        patient: { email: 'client@patients.example.test', name: 'Client Example' },
        settings: { ...TEST_CLINIC_SETTINGS, clinicName, includeContactInConfirmation: true, timeZone: 'Europe/Paris' },
        from: 'noreply@clinic.test',
        publicUrl: new URL('https://clinic.test'),
        tenant,
      });
      expect(email.subject).toBe(`Reminder: your ${noun} at ${clinicName}`);
      expect(email.text.startsWith(`${clinicName}\n`)).toBe(true);
      expect(email.text).toContain('Sun, 25 Oct 2026, 09:00 (UK time, Europe/London)');
      expect(email.text).toContain(`Your ${practitioner}: Alex Example`);
      expect(email.text).toContain('Duration: 45 minutes');
      expect(email.text).toContain(`Reschedule: https://clinic.test/bookings/${booking.id}/reschedule`);
      expect(email.text).toContain(`Cancel: https://clinic.test/bookings/${booking.id}/review`);
      expect(email.text).not.toMatch(/phone|7700|password|token/i);
    },
  );
  it('shows the correct UK summer time and actual duration after a move', () => {
    const email = composeReminder({
      booking: { ...booking, startsAt: new Date('2027-03-28T08:00:00Z'), endsAt: new Date('2027-03-28T08:30:00Z') },
      patient: { email: 'client@patients.example.test', name: 'Client Example' },
      settings: TEST_CLINIC_SETTINGS,
      from: 'noreply@clinic.test',
      publicUrl: new URL('https://clinic.test'),
      tenant: 'beacon',
    });
    expect(email.text).toContain('Sun, 28 Mar 2027, 09:00');
    expect(email.text).toContain('Duration: 30 minutes');
  });
});

describe('sign-in return paths for reminders', () => {
  it('keeps only private booking review destinations', () => {
    for (const path of [
      `/bookings/${booking.id}/review`,
      `/bookings/${booking.id}/reschedule`,
      `/bookings/${booking.id}/review?slot=${booking.slotId}`,
    ]) {
      expect(bookingReturnPath(path)).toBe(path);
    }
    for (const path of [
      'https://outside.test',
      '//outside.test',
      '/admin/settings',
      '/bookings/../../admin/review',
      `/bookings/${booking.id}/review?next=https://outside.test`,
      undefined,
    ]) {
      expect(bookingReturnPath(path)).toBeNull();
    }
  });
});
