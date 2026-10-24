import { formatSlot } from '@/lib/time';
import type { BookingView } from '../bookings/queries';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export interface ConfirmationInput {
  booking: BookingView;
  patient: { email: string; name: string };
  settings: ClinicSettings;
  from: string;
}

/** A stored phone number as it appears in an email. */
export function formatPhone(phone: string): string {
  return phone.trim().replace(/\s+/g, ' ');
}

/**
 * The booking confirmation (plan 12.1). With `includeContactInConfirmation`
 * on, it repeats the contact phone the patient gave; the phone is optional,
 * so the line is left out when there is none.
 */
export function composeConfirmation(input: ConfirmationInput): OutgoingEmail {
  const { booking, patient, settings } = input;
  const when = formatSlot(booking.startsAt, settings.timeZone);
  const lines = [
    `Dear ${patient.name},`,
    '',
    `Your appointment at ${settings.clinicName} is confirmed.`,
    '',
    `When: ${when} (${settings.timeZone})`,
    `With: ${booking.practitionerName}`,
    `Booking reference: ${booking.id}`,
  ];
  if (settings.includeContactInConfirmation && booking.phone !== null) {
    lines.push(`Contact phone: ${formatPhone(booking.phone)}`);
  }
  lines.push('', 'To cancel or reschedule, sign in to BookIt and open My bookings.', '', settings.clinicName);
  return {
    from: input.from,
    to: patient.email,
    subject: `Booking confirmed: ${when}`,
    text: `${lines.join('\n')}\n`,
  };
}
