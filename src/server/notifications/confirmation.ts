import { formatSlot } from '@/lib/time';
import { reportError } from '../error-reporting';
import { bookingCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from '../bookings/calendar';
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
  const moved = booking.rescheduleCount > 0;
  const lines = [
    settings.clinicName,
    '',
    `Dear ${patient.name},`,
    '',
    `Your appointment at ${settings.clinicName} ${moved ? 'has been moved' : 'is confirmed'}.`,
    '',
    `When: ${when} (${settings.timeZone})`,
    `With: ${booking.practitionerName}`,
    `Duration: ${(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes`,
    `Booking reference: ${booking.id}`,
  ];
  if (settings.includeContactInConfirmation && booking.phone) {
    lines.push(`Contact phone: ${formatPhone(booking.phone)}`);
  }
  lines.push(
    '',
    'Add to calendar by importing the attached booking.ics file into Google, Outlook or Apple Calendar.',
    'After a move, import the new file and check that your calendar shows the new time.',
    'To cancel or reschedule, sign in to BookIt and open My bookings.',
    '',
    settings.clinicName,
  );
  return {
    from: input.from,
    to: patient.email,
    subject: `Booking ${moved ? 'moved' : 'confirmed'}: ${when}`,
    text: `${lines.join('\n')}\n`,
    attachments: [
      { filename: CALENDAR_FILENAME, content: bookingCalendar(booking, settings), contentType: CALENDAR_CONTENT_TYPE },
    ],
  };
}
