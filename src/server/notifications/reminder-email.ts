import { bookingSignInPath } from '@/lib/routes';
import { formatSlot } from '@/lib/time';
import type { OutgoingEmail } from './mailer';

interface ReminderEmailInput {
  bookingId: string;
  startsAt: Date;
  practitionerName: string;
  clinicName: string;
  timeZone: string;
  publicUrl: URL;
  from: string;
  to: string;
}

export function composeReminderEmail(input: ReminderEmailInput): OutgoingEmail {
  const { bookingId, startsAt, practitionerName, clinicName, timeZone, publicUrl, from, to } = input;
  const when = formatSlot(startsAt, timeZone);
  const reschedule = new URL(bookingSignInPath({ bookingId, intent: 'reschedule' }), publicUrl);
  const cancel = new URL(bookingSignInPath({ bookingId, intent: 'cancel' }), publicUrl);
  const lines = [
    clinicName,
    '',
    'Your session is coming up.',
    `${when} (${timeZone})`,
    `With ${practitionerName}, your physiotherapist`,
    '',
    'Sign in to manage your session.',
    '',
    'Reschedule your session',
    reschedule.href,
    '',
    'Cancel your session',
    cancel.href,
  ];
  return { from, to, subject: `Session reminder from ${clinicName}`, text: `${lines.join('\n')}\n` };
}
