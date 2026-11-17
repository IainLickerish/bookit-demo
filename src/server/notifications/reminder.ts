import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { OutgoingEmail } from './mailer';

export interface ReminderInput {
  clinic: Pick<ClinicSettings, 'clinicName' | 'timeZone'>;
  patient: { name: string; email: string };
  booking: { id: string; startsAt: Date; practitionerName: string };
  words: { booking: 'session' | 'appointment'; practitioner: string };
  publicUrl: URL;
  from: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!;
  });
}

export function composeReminder(input: ReminderInput): OutgoingEmail {
  const { clinic, booking, patient, words } = input;
  const when = `${formatSlot(booking.startsAt, clinic.timeZone)} (${clinic.timeZone})`;
  const link = new URL(`/bookings#booking-${booking.id}`, input.publicUrl).toString();
  const lines = [
    clinic.clinicName,
    '',
    `Dear ${patient.name},`,
    '',
    `This is a reminder of your ${words.booking} at ${clinic.clinicName}.`,
    `When: ${when}`,
    `With your ${words.practitioner}: ${booking.practitionerName}`,
    '',
    `To reschedule your ${words.booking}, sign in to My bookings: ${link}`,
    `To cancel your ${words.booking}, sign in to My bookings: ${link}`,
  ];
  return {
    from: input.from,
    to: patient.email,
    subject: `Your ${words.booking} reminder: ${formatSlot(booking.startsAt, clinic.timeZone)}`,
    text: `${lines.join('\n')}\n`,
    html: `<div style="background:#FAF8F4;color:#16241F;font:16px/1.6 Figtree,Arial,sans-serif;padding:24px">
<h1 style="font:500 32px Fraunces,Georgia,serif">${escapeHtml(clinic.clinicName)}</h1>
<p>${escapeHtml(lines[2]!)}</p><p>${escapeHtml(lines[4]!)}</p>
<p>${escapeHtml(lines[5]!)}<br>${escapeHtml(lines[6]!)}</p>
<p>Sign in to My bookings to <a style="color:#1D5C4B;display:inline-block;min-height:44px;padding:8px 0;box-sizing:border-box" href="${escapeHtml(link)}">reschedule your ${words.booking}</a>
or <a style="color:#1D5C4B;display:inline-block;min-height:44px;padding:8px 0;box-sizing:border-box" href="${escapeHtml(link)}">cancel your ${words.booking}</a>.</p>
</div>`,
  };
}
