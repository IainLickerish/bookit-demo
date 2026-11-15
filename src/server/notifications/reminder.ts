import { formatSlot } from '@/lib/time';
import type { BookingView } from '../bookings/queries';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/** Elapsed hours, including on the days the UK clocks change. */
export function reminderIsDue(startsAt: Date, now: Date): boolean {
  const remaining = startsAt.getTime() - now.getTime();
  return remaining > 0 && remaining <= REMINDER_LEAD_MS;
}

export function composeReminder(input: {
  booking: BookingView;
  patient: { email: string; name: string };
  settings: ClinicSettings;
  from: string;
  publicUrl: URL;
  tenant: string;
}): OutgoingEmail {
  const { booking, patient, settings } = input;
  const session = input.tenant === 'acme' ? 'session' : 'appointment';
  const practitioner = input.tenant === 'acme' ? 'physiotherapist' : 'clinician';
  // This ticket explicitly asks for UK time, even if staff change the display zone.
  const when = formatSlot(booking.startsAt, 'Europe/London');
  const reschedule = new URL(`/bookings/${booking.id}/reschedule`, input.publicUrl);
  const cancel = new URL(`/bookings#booking-${booking.id}`, input.publicUrl);
  return {
    from: input.from,
    to: patient.email,
    subject: `Booking reminder: ${when}`,
    text: [
      settings.clinicName,
      '',
      `Dear ${patient.name},`,
      '',
      `This is a reminder of your ${session} at ${settings.clinicName}.`,
      '',
      `When: ${when} (UK time, Europe/London)`,
      `With: ${booking.practitionerName}, your ${practitioner}`,
      `Booking reference: ${booking.id}`,
      '',
      'Sign in with your clinic account to manage your booking.',
      `Reschedule: ${reschedule.href}`,
      `Cancel in My bookings: ${cancel.href}`,
      '',
      'You can also check your booking in My bookings.',
      '',
    ].join('\n'),
  };
}
