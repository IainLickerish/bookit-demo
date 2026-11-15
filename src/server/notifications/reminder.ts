import { clinicWords } from '@/lib/booking-paths';
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
  const { booking: word, practitioner } = clinicWords(input.tenant);
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
      `Reschedule: ${new URL(`/bookings/${input.booking.id}/reschedule`, input.publicUrl).toString()}`,
      `Cancel: ${new URL(`/bookings/${input.booking.id}/cancel`, input.publicUrl).toString()}`,
      'Sign in to review your current booking details and confirm any change.',
      'My bookings shows your latest booking details if an email does not arrive.',
      '',
    ].join('\n'),
  };
}
