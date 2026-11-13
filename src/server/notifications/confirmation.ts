import { calendarDetails } from '@/lib/calendar';
import { formatSlot } from '@/lib/time';
import { reportError } from '../error-reporting';
import type { BookingView } from '../bookings/queries';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export interface ConfirmationInput {
  booking: BookingView;
  patient: { email: string; name: string };
  settings: ClinicSettings;
  from: string;
  moved?: boolean;
}

/** A stored phone number as it appears in an email. */
export function formatPhone(phone: string): string {
  try {
    return phone.trim().replace(/\s+/g, ' ');
  } catch (error) {
    reportError(error, { operation: 'confirmation.compose' }, ['bookit', 'confirmation.phone']);
    throw error;
  }
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
    settings.clinicName,
    '',
    `Dear ${patient.name},`,
    '',
    input.moved
      ? `Your booking at ${settings.clinicName} has been moved.`
      : `Your appointment at ${settings.clinicName} is confirmed.`,
    '',
    `When: ${when} (${settings.timeZone})`,
    `With: ${booking.practitionerName}`,
    `Booking reference: ${booking.id}`,
  ];
  if (settings.includeContactInConfirmation && booking.phone) {
    lines.push(`Contact phone: ${formatPhone(booking.phone)}`);
  }
  lines.push(
    '',
    'Add to calendar',
    calendarDetails({
      clinicName: settings.clinicName,
      timeZone: settings.timeZone,
      practitionerName: booking.practitionerName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    }),
    '',
    'Create an event in Google Calendar, Outlook or Apple Calendar using these details.',
    'If you move or cancel your booking, update or remove the existing calendar event yourself. BookIt does not update your calendar.',
  );
  lines.push('', 'To cancel or reschedule, sign in to BookIt and open My bookings.', '', settings.clinicName);
  return {
    from: input.from,
    to: patient.email,
    subject: `${input.moved ? 'Booking moved' : 'Booking confirmed'}: ${when}`,
    text: `${lines.join('\n')}\n`,
  };
}
