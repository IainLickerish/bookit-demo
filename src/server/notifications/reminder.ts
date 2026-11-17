import { formatSlot } from '@/lib/time';
import type { BookingView } from '../bookings/queries';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export function composeReminder(input: {
  booking: BookingView;
  patient: { email: string; name: string };
  settings: ClinicSettings;
  from: string;
  publicUrl: URL;
  tenant: string;
}): OutgoingEmail {
  const { booking, patient, settings } = input;
  const when = formatSlot(booking.startsAt, 'Europe/London');
  const appointment = input.tenant === 'acme' ? 'session' : 'appointment';
  const practitioner = input.tenant === 'acme' ? 'physiotherapist' : 'clinician';
  const bookingsUrl = new URL('/bookings', input.publicUrl).href;
  return {
    from: input.from,
    to: patient.email,
    subject: `Your ${appointment} reminder: ${when}`,
    text: [
      settings.clinicName,
      '',
      `Dear ${patient.name},`,
      '',
      `This is a reminder of your ${appointment} at ${settings.clinicName}.`,
      '',
      `When: ${when} (UK time, Europe/London)`,
      `Your ${practitioner}: ${booking.practitionerName}`,
      '',
      `To reschedule or cancel, open My bookings: ${bookingsUrl}`,
      'Sign in with your own account if asked.',
      '',
    ].join('\n'),
  };
}
