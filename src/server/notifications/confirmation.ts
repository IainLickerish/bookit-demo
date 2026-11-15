import type { Logger } from '@/lib/logger';
import { formatSlot } from '@/lib/time';
import { appointmentCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from '../calendar/appointment';
import { deliverEmail, type MailSettings } from './deliver';
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
    `Duration: ${(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes`,
    `Booking reference: ${booking.id}`,
  ];
  if (settings.includeContactInConfirmation && booking.phone) {
    lines.push(`Contact phone: ${formatPhone(booking.phone)}`);
  }
  lines.push(
    '',
    'Open the attached calendar file to add this booking to Google, Outlook or Apple Calendar.',
    'If you move or cancel, update your calendar too. My bookings always shows the current booking.',
    '',
    'To cancel or reschedule, sign in to BookIt and open My bookings.',
    '',
    settings.clinicName,
  );
  return {
    from: input.from,
    to: patient.email,
    subject: `Booking ${input.moved ? 'rescheduled' : 'confirmed'}: ${when}`,
    text: `${lines.join('\n')}\n`,
    attachments: [
      {
        filename: CALENDAR_FILENAME,
        contentType: CALENDAR_CONTENT_TYPE,
        content: appointmentCalendar(booking, settings),
      },
    ],
  };
}

/** Compose and deliver after commit, so calendar or mail failures never undo a saved booking. */
export async function sendConfirmation(input: ConfirmationInput, mail: MailSettings, log: Logger): Promise<void> {
  try {
    await deliverEmail(mail, log, composeConfirmation(input), 'confirmation', { booking_id: input.booking.id });
  } catch (error) {
    log.error(
      {
        event: 'email.confirmation.failed',
        booking_id: input.booking.id,
        error_name: error instanceof Error ? error.name : 'unknown',
      },
      'Confirmation unavailable',
    );
    reportError(error, { operation: 'confirmation.compose' });
  }
}
