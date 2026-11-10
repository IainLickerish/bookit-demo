import { formatAppointmentTime } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export interface ReminderInput {
  booking: { id: string; startsAt: Date; practitionerName: string };
  patient: { email: string; name: string };
  settings: Pick<ClinicSettings, 'clinicName' | 'timeZone'>;
  /** The origin patients reach BookIt at, from BOOKIT_PUBLIC_URL. */
  publicUrl: URL;
  from: string;
}

export function reschedulePath(bookingId: string): string {
  return `/bookings/${encodeURIComponent(bookingId)}/reschedule`;
}

export function cancelPath(bookingId: string): string {
  return `/bookings/${encodeURIComponent(bookingId)}/cancel`;
}

/**
 * The appointment reminder, sent about 24 hours before the appointment. The
 * links open pages that ask the patient to sign in and confirm; opening a link
 * never changes a booking by itself, so mail scanners that follow links are
 * harmless.
 */
export function composeReminder(input: ReminderInput): OutgoingEmail {
  const { booking, patient, settings } = input;
  const when = formatAppointmentTime(booking.startsAt, settings.timeZone);
  const lines = [
    `Dear ${patient.name},`,
    '',
    `This is a reminder of your appointment at ${settings.clinicName}.`,
    '',
    `When: ${when}`,
    `With: ${booking.practitionerName}`,
    `Booking reference: ${booking.id}`,
    '',
    'To reschedule:',
    new URL(reschedulePath(booking.id), input.publicUrl).toString(),
    '',
    'To cancel:',
    new URL(cancelPath(booking.id), input.publicUrl).toString(),
    '',
    settings.clinicName,
  ];
  return {
    from: input.from,
    to: patient.email,
    subject: `Reminder: your appointment on ${when}`,
    text: `${lines.join('\n')}\n`,
  };
}
