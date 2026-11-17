import { describe, expect, it } from 'vitest';
import { composeReminder, type ReminderInput } from '@/server/notifications/reminder';

const input: ReminderInput = {
  clinic: { clinicName: 'Acme Physio', timeZone: 'Europe/London' },
  patient: { name: 'Demo Client', email: 'demo@patients.acmephysio.test' },
  booking: { id: 'booking-reference', startsAt: new Date('2026-10-25T09:00:00Z'), practitionerName: 'Alex' },
  words: { booking: 'session', practitioner: 'physiotherapist' },
  publicUrl: new URL('https://acme.example.test'),
  from: 'noreply@acmephysio.test',
};

describe('reminder content', () => {
  it.each([
    ['2026-10-24T08:00:00Z', 'Sat, 24 Oct 2026, 09:00'],
    ['2026-10-25T09:00:00Z', 'Sun, 25 Oct 2026, 09:00'],
    ['2027-03-27T09:00:00Z', 'Sat, 27 Mar 2027, 09:00'],
    ['2027-03-28T08:00:00Z', 'Sun, 28 Mar 2027, 09:00'],
  ])('shows the correct clinic-local time for %s', (instant, when) => {
    const email = composeReminder({ ...input, booking: { ...input.booking, startsAt: new Date(instant) } });
    expect(email.to).toBe(input.patient.email);
    expect(email.from).toBe(input.from);
    expect(email.text.startsWith('Acme Physio\n')).toBe(true);
    expect(email.text).toContain(`When: ${when} (Europe/London)`);
    expect(email.text).toContain('With your physiotherapist: Alex');
    expect(email.html).toContain(when);
    expect(email.subject).toContain(when);
    expect(email.text.match(/https:\/\/acme.example.test\/bookings#booking-booking-reference/g)).toHaveLength(2);
    expect(email.html?.match(/href="https:\/\/acme.example.test\/bookings#booking-booking-reference"/g)).toHaveLength(
      2,
    );
    expect(email.text).not.toMatch(/phone|token|password/i);
  });
  it('uses Beacon words and escapes names in HTML', () => {
    const email = composeReminder({
      ...input,
      clinic: { clinicName: 'Beacon <Dental>', timeZone: 'Europe/London' },
      patient: { ...input.patient, name: '<script>Demo</script>' },
      booking: { ...input.booking, practitionerName: 'Blair & Taylor' },
      words: { booking: 'appointment', practitioner: 'clinician' },
    });
    expect(email.text).toContain('your appointment');
    expect(email.text).toContain('With your clinician: Blair & Taylor');
    expect(email.html).toContain('Beacon &lt;Dental&gt;');
    expect(email.html).toContain('&lt;script&gt;Demo&lt;/script&gt;');
    expect(email.html).toContain('Blair &amp; Taylor');
    expect(email.html).not.toContain('<script>');
  });
});
