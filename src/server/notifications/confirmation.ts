import { formatSlot } from '@/lib/time';
import { reportError } from '../error-reporting';
import type { BookingView } from '../bookings/queries';
import {
  appointmentMinutes,
  bookingCalendarFile,
  CALENDAR_CONTENT_TYPE,
  calendarFileName,
} from '../calendar/appointment';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export interface ConfirmationInput {
  booking: BookingView;
  patient: { email: string; name: string };
  settings: ClinicSettings;
  from: string;
  /** `rescheduled` confirms a booking moved to a new time; the default is a new booking. */
  kind?: 'booked' | 'rescheduled';
  /** When the email is composed, from the application clock; stamps the calendar file. */
  now: Date;
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
 * The booking confirmation (plan 12.1), sent when a booking is made or moved.
 * With `includeContactInConfirmation` on, it repeats the contact phone the
 * patient gave; the phone is optional, so the line is left out when there is
 * none. A calendar file for the appointment is attached.
 */
export function composeConfirmation(input: ConfirmationInput): OutgoingEmail {
  const { booking, patient, settings } = input;
  const rescheduled = input.kind === 'rescheduled';
  const when = formatSlot(booking.startsAt, settings.timeZone);
  const lines = [
    `Dear ${patient.name},`,
    '',
    rescheduled
      ? `Your appointment at ${settings.clinicName} has been moved. The new time is below.`
      : `Your appointment at ${settings.clinicName} is confirmed.`,
    '',
    `When: ${when} (${settings.timeZone})`,
    `Length: ${appointmentMinutes(booking)} minutes`,
    `With: ${booking.practitionerName}`,
    `Booking reference: ${booking.id}`,
  ];
  if (settings.includeContactInConfirmation) {
    lines.push(`Contact phone: ${formatPhone(booking.phone!)}`);
  }
  lines.push(
    '',
    rescheduled
      ? 'To add the new time to your calendar, open the attached calendar file. If your calendar still shows the old time, delete that entry.'
      : 'To add this appointment to your calendar, open the attached calendar file.',
    'To cancel or reschedule, sign in to BookIt and open My bookings.',
    '',
    settings.clinicName,
  );
  return {
    from: input.from,
    to: patient.email,
    subject: `${rescheduled ? 'Booking moved' : 'Booking confirmed'}: ${when}`,
    text: `${lines.join('\n')}\n`,
    attachments: [
      {
        filename: calendarFileName(booking, settings),
        content: bookingCalendarFile(booking, settings, input.now),
        contentType: CALENDAR_CONTENT_TYPE,
      },
    ],
  };
}
