import { clinicWords } from '@/lib/clinic-words';
import { formatSlot } from '@/lib/time';
import type { ConfirmationInput } from './confirmation';
import type { OutgoingEmail } from './mailer';

export const REMINDER_EARLIEST_HOURS = 24;
export const REMINDER_LATEST_HOURS = 23;

/** Elapsed hours, not local calendar arithmetic, including on clock-change days. */
export function reminderDue(startsAt: Date, now: Date): boolean {
  const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
  return hours >= REMINDER_LATEST_HOURS && hours <= REMINDER_EARLIEST_HOURS;
}

export function composeReminder(input: ConfirmationInput & { publicUrl: URL; tenant?: string }): OutgoingEmail {
  const { booking, patient, settings, publicUrl } = input;
  const words = clinicWords(input.tenant);
  const when = formatSlot(booking.startsAt, 'Europe/London');
  const path = `/bookings/${booking.id}`;
  return {
    from: input.from,
    to: patient.email,
    subject: `Reminder: your ${words.appointment} at ${settings.clinicName}`,
    text: [
      settings.clinicName,
      '',
      `Dear ${patient.name},`,
      '',
      `Your ${words.appointment} is coming up.`,
      `When: ${when} (UK time, Europe/London)`,
      `Your ${words.practitioner}: ${booking.practitionerName}`,
      `Duration: ${(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes`,
      '',
      `Reschedule: ${new URL(`${path}/reschedule`, publicUrl).href}`,
      `Cancel: ${new URL(`${path}/review`, publicUrl).href}`,
      '',
      'Sign in to review your current booking before confirming a change.',
      'If you have already changed it, check My bookings for the current details.',
      '',
    ].join('\n'),
  };
}
