import { describe, expect, it } from 'vitest';
import { reminderIsDue } from '@/server/reminders/send';
import { composeReminder } from '@/server/notifications/reminder';
import { deliverEmail } from '@/server/notifications/deliver';
import type { Mailer } from '@/server/notifications/mailer';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';
import { TEST_MAIL_FROM } from '../helpers/mail';

const input = {
  clinicName: 'Fictional Clinic',
  tenant: 'acme' as const,
  patient: { email: 'reminder@patients.example.test', name: 'Reminder Client' },
  booking: {
    id: 'fictional-booking',
    startsAt: new Date('2026-10-24T08:15:00Z'),
    practitionerName: 'Fictional Practitioner',
  },
  from: TEST_MAIL_FROM,
  publicUrl: new URL('https://clinic.example.test'),
};

describe('reminder eligibility and wording', () => {
  it.each([
    ['2026-10-21T07:00:00Z', true],
    ['2026-10-21T07:00:00.001Z', false],
    ['2026-10-20T07:00:00.001Z', true],
    ['2026-10-20T07:00:00Z', false],
    ['2026-10-20T06:59:59Z', false],
  ] as const)('checks the elapsed 24-hour boundary for %s', (start, due) => {
    expect(reminderIsDue(new Date(start), new Date('2026-10-20T07:00:00Z'))).toBe(due);
  });
  it.each([
    ['2026-10-24T09:00:00Z', '2026-10-25T09:00:00Z'],
    ['2027-03-27T09:00:00Z', '2027-03-28T09:00:00Z'],
  ])('uses elapsed hours across clock changes from %s', (now, start) => {
    expect(reminderIsDue(new Date(start), new Date(now))).toBe(true);
    expect(reminderIsDue(new Date(new Date(start).getTime() + 1), new Date(now))).toBe(false);
  });
  it.each([
    ['2026-10-24T08:15:00Z', 'Sat, 24 Oct 2026, 09:15'],
    ['2026-10-26T09:15:00Z', 'Mon, 26 Oct 2026, 09:15'],
    ['2027-03-29T08:15:00Z', 'Mon, 29 Mar 2027, 09:15'],
  ])('shows UK time correctly for %s', (start, when) => {
    const email = composeReminder({ ...input, booking: { ...input.booking, startsAt: new Date(start) } });
    expect(email.subject).toBe(`Reminder: your session on ${when}`);
    expect(email.text).toContain(`When: ${when} (UK time)`);
    expect(email.text.startsWith('Fictional Clinic\n')).toBe(true);
    expect(email.text).toContain('Physiotherapist: Fictional Practitioner');
    expect(email.text).toContain('Booking reference: fictional-booking');
    expect(email.text).toContain('https://clinic.example.test/bookings');
    expect(email.text).not.toContain('phone');
  });
  it('uses Beacon’s words and separate signed-in booking destinations', () => {
    const email = composeReminder({ ...input, tenant: 'beacon' });
    expect(email.subject).toContain('your appointment');
    expect(email.text).toContain('Clinician: Fictional Practitioner');
    expect(email.text).toContain('Reschedule: https://clinic.example.test/bookings/fictional-booking/reschedule');
    expect(email.text).toContain('Cancel: https://clinic.example.test/bookings/fictional-booking/cancel');
    expect(email.text).toContain('Sign in to review your current booking details and confirm any change.');
    expect(email.to).toBe(input.patient.email);
  });
  it('does not call an unconfirmed SMTP result a confirmed reminder', async () => {
    const logs = captureLogs(manualClock('2026-10-20T07:00:00Z'));
    const mailer: Mailer = { kind: 'smtp', send: async () => ({ messageId: null }) };
    expect(await deliverEmail({ from: TEST_MAIL_FROM, mailer }, logs.log, composeReminder(input), 'reminder')).toBe(
      false,
    );
    expect(logs.events()).toEqual(['email.reminder.unconfirmed']);
    expect(JSON.stringify(logs.lines)).not.toContain(input.patient.email);
    expect(JSON.stringify(logs.lines)).not.toContain(input.patient.name);
  });
});
