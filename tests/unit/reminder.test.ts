import { describe, expect, it } from 'vitest';
import { composeReminder } from '@/server/notifications/reminder';

const input = {
  id: '019a0000-0000-7000-8000-00000000b001',
  practitionerName: 'Pat Physio',
  patient: { email: 'patient@patients.clinic.test', name: 'Patient One' },
  clinicName: 'Test Clinic',
  from: 'noreply@clinic.test',
  publicUrl: new URL('https://clinic.test'),
};

describe('appointment reminder emails', () => {
  it.each([
    ['2027-01-15T09:30:00Z', 'Fri, 15 Jan 2027, 09:30'],
    ['2027-07-15T09:30:00Z', 'Thu, 15 Jul 2027, 10:30'],
    ['2027-03-28T01:30:00Z', 'Sun, 28 Mar 2027, 02:30'],
    ['2027-10-31T01:30:00Z', 'Sun, 31 Oct 2027, 01:30'],
  ])('shows the date and UK time for %s', (instant, expected) => {
    const email = composeReminder({ ...input, startsAt: new Date(instant) });
    expect(email.subject).toBe(`Appointment reminder: ${expected}`);
    expect(email.text).toContain(`When: ${expected} (UK time, Europe/London)`);
    expect(email.text).toContain('With: Pat Physio');
    expect(email.text).toContain('Dear Patient One,');
    expect(email.to).toBe(input.patient.email);
    expect(email.from).toBe(input.from);
  });

  it('links to the booking controls on the configured clinic website', () => {
    const email = composeReminder({ ...input, startsAt: new Date('2027-01-15T09:30:00Z') });
    expect(email.text).toContain(`Reschedule: https://clinic.test/bookings/${input.id}/reschedule`);
    expect(email.text).toContain(`Cancel: https://clinic.test/bookings#booking-${input.id}`);
    expect(email.text).toContain('Sign in to manage your booking.');
  });
});
