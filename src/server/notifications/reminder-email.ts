import { bookingRowId, rescheduleBookingPath, signInPath } from '@/lib/routes';
import { formatSlot } from '@/lib/time';
import type { OutgoingEmail } from './mailer';

interface ReminderEmailInput {
  bookingId: string;
  startsAt: Date;
  clinicName: string;
  timeZone: string;
  practitionerName: string;
  patientName: string;
  patientEmail: string;
  publicUrl: URL;
  from: string;
}

export function composeReminder(input: ReminderEmailInput): OutgoingEmail {
  const ukTimeZone = 'Europe/London';
  const when = formatSlot(input.startsAt, input.timeZone);
  const where = input.timeZone === ukTimeZone ? 'UK time' : input.timeZone;
  const reschedule = new URL(signInPath({ next: rescheduleBookingPath(input.bookingId) }), input.publicUrl);
  const cancel = new URL(signInPath({ next: `/bookings#${bookingRowId(input.bookingId)}` }), input.publicUrl);
  const lines = [
    input.clinicName,
    '',
    `Dear ${input.patientName},`,
    '',
    'This is a reminder about your upcoming session.',
    `Your session is on ${when} (${where}) with ${input.practitionerName}, your physiotherapist.`,
  ];
  if (input.timeZone !== ukTimeZone) {
    lines.push(`In the UK, your session starts at ${formatSlot(input.startsAt, ukTimeZone)}.`);
  }
  lines.push(
    '',
    'Sign in to reschedule your session.',
    reschedule.href,
    '',
    'Sign in to cancel your session in My bookings.',
    cancel.href,
    '',
  );
  return { from: input.from, to: input.patientEmail, subject: 'Your session reminder', text: lines.join('\n') };
}
