import { bookingRowId, rescheduleBookingPath, signInPath } from '@/lib/routes';
import { formatSlot } from '@/lib/time';
import type { OutgoingEmail } from './mailer';

interface ReminderEmailInput {
  bookingId: string;
  startsAt: Date;
  clinicName: string;
  practitionerName: string;
  patientName: string;
  patientEmail: string;
  publicUrl: URL;
  from: string;
}

export function composeReminder(input: ReminderEmailInput): OutgoingEmail {
  const when = formatSlot(input.startsAt, 'Europe/London');
  const reschedule = new URL(signInPath({ next: rescheduleBookingPath(input.bookingId) }), input.publicUrl);
  const cancel = new URL(signInPath({ next: `/bookings#${bookingRowId(input.bookingId)}` }), input.publicUrl);
  const lines = [
    input.clinicName,
    '',
    `Dear ${input.patientName},`,
    '',
    'This is a reminder about your upcoming session.',
    `Your session is on ${when} (UK time) with ${input.practitionerName}, your physiotherapist.`,
    '',
    'Sign in to reschedule your session.',
    reschedule.href,
    '',
    'Sign in to cancel your session in My bookings.',
    cancel.href,
    '',
  ];
  return { from: input.from, to: input.patientEmail, subject: 'Your session reminder', text: lines.join('\n') };
}
