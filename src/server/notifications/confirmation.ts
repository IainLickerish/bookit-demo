import { emailHash, type Logger } from '@/lib/logger';
import { formatSlot } from '@/lib/time';
import type { BookingView } from '../bookings/queries';
import { reportError } from '../error-reporting';
import type { ClinicSettings } from '../settings';
import type { Mailer, OutgoingEmail } from './mailer';

export interface MailSettings {
  mailer: Mailer;
  /** The clinic's sender address, from BOOKIT_MAIL_FROM. */
  from: string;
}

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

/**
 * Sends a confirmation after the booking has committed. A failed email never
 * undoes a booking: it is logged and reported, and the patient still sees the
 * booking in "My bookings".
 */
export async function sendConfirmation(
  mail: MailSettings,
  log: Logger,
  email: OutgoingEmail,
  bookingId: string,
): Promise<boolean> {
  const recipientHash = emailHash(email.to);
  try {
    const sent = await mail.mailer.send(email);
    log.info(
      {
        event: 'email.confirmation.sent',
        booking_id: bookingId,
        recipient_hash: recipientHash,
        mailer: mail.mailer.kind,
        message_id: sent.messageId,
      },
      mail.mailer.kind === 'disabled'
        ? 'Confirmation email not sent: no SMTP server configured'
        : 'Confirmation email sent',
    );
    return true;
  } catch (error) {
    log.error(
      {
        event: 'email.confirmation.failed',
        booking_id: bookingId,
        recipient_hash: recipientHash,
        mailer: mail.mailer.kind,
        error_name: error instanceof Error ? error.name : 'unknown',
      },
      'Confirmation email failed',
    );
    reportError(error, { operation: 'confirmation_email' });
    return false;
  }
}
