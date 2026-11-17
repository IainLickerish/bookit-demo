import { describe, expect, it } from 'vitest';
import type { BookingView } from '@/server/bookings/queries';
import { composeReminder } from '@/server/notifications/reminder';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

const booking: BookingView = {
  id: 'booking-reference',
  patientId: 'patient',
  status: 'confirmed',
  lateCancellation: false,
  phone: '+44 7700 900001',
  rescheduleCount: 0,
  cancelledAt: null,
  createdAt: new Date('2026-07-01T08:00:00Z'),
  updatedAt: new Date('2026-07-01T08:00:00Z'),
  slotId: 'slot',
  startsAt: new Date('2026-07-02T08:00:00Z'),
  endsAt: new Date('2026-07-02T08:45:00Z'),
  practitionerId: 'practitioner',
  practitionerName: 'Alex Practitioner',
};

describe('reminder wording and links', () => {
  it.each([
    ['acme', 'Acme Physio', 'session', 'physiotherapist'],
    ['beacon', 'Beacon Dental', 'appointment', 'clinician'],
  ])('uses %s words, UK time and its trusted My bookings link', (tenant, clinicName, appointment, practitioner) => {
    const email = composeReminder({
      booking,
      patient: { name: 'Test Patient', email: `patient@patients.${tenant}.test` },
      settings: { ...TEST_CLINIC_SETTINGS, clinicName, timeZone: 'Europe/Paris' },
      tenant,
      from: `noreply@${tenant}.test`,
      publicUrl: new URL(`https://${tenant}.example.test`),
    });
    expect(email.subject).toBe(`Your ${appointment} reminder: Thu, 2 Jul 2026, 09:00`);
    expect(email.text.startsWith(`${clinicName}\n`)).toBe(true);
    expect(email.text).toContain(`your ${appointment} at ${clinicName}`);
    expect(email.text).toContain('When: Thu, 2 Jul 2026, 09:00 (UK time, Europe/London)');
    expect(email.text).toContain(`Your ${practitioner}: Alex Practitioner`);
    expect(email.text).toContain(`To reschedule or cancel, open My bookings: https://${tenant}.example.test/bookings`);
    expect(email.text).not.toContain('7700');
    expect(email.text).not.toContain('token');
  });
});
