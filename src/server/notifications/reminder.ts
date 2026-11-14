import { formatSlot } from '@/lib/time';
import type { TenantName } from '@/server/seed/tenant';
import type { OutgoingEmail } from './mailer';

export interface ReminderEmailInput {
  clinicName: string;
  tenant: TenantName;
  patient: { email: string; name: string };
  booking: { id: string; startsAt: Date; practitionerName: string };
  from: string;
  publicUrl: URL;
}

export function composeReminder(input: ReminderEmailInput): OutgoingEmail {
  const word = input.tenant === 'acme' ? 'session' : 'appointment';
  const practitioner = input.tenant === 'acme' ? 'Physiotherapist' : 'Clinician';
  const when = formatSlot(input.booking.startsAt, 'Europe/London');
  return {
    from: input.from,
    to: input.patient.email,
    subject: `Reminder: your ${word} on ${when}`,
    text: [
      input.clinicName,
      '',
      `Dear ${input.patient.name},`,
      '',
      `This is a reminder of your ${word}.`,
      `When: ${when} (UK time)`,
      `${practitioner}: ${input.booking.practitionerName}`,
      `Booking reference: ${input.booking.id}`,
      '',
      `To reschedule or cancel, sign in and open My bookings: ${new URL('/bookings', input.publicUrl).toString()}`,
      'My bookings shows your latest booking details if an email does not arrive.',
      '',
    ].join('\n'),
  };
}
