import { bookingAnchor, rescheduleBookingPath, signInPath } from '@/lib/routes';
import { formatSlot } from '@/lib/time';
import type { OutgoingEmail } from './mailer';

interface ReminderEmailInput {
  bookingId: string;
  startsAt: Date;
  practitionerName: string;
  to: string;
  from: string;
  clinicName: string;
  timeZone: string;
  tenant: string;
  publicUrl: URL;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function composeReminderEmail(input: ReminderEmailInput): OutgoingEmail {
  const { bookingId, clinicName, timeZone, publicUrl } = input;
  const appointment = input.tenant === 'acme' ? 'session' : 'appointment';
  const when = formatSlot(input.startsAt, timeZone);
  const details = `Your ${appointment} is on ${when} (${timeZone}) with ${input.practitionerName}.`;
  const instructions = 'Sign in to reschedule or cancel your booking.';
  const links = [
    { label: `Reschedule your ${appointment}`, path: rescheduleBookingPath(bookingId) },
    { label: `Cancel your ${appointment}`, path: `/bookings#${bookingAnchor(bookingId)}` },
  ].map(({ label, path }) => ({ label, url: new URL(signInPath(path), publicUrl).href }));

  return {
    from: input.from,
    to: input.to,
    subject: `Reminder for your ${appointment} at ${clinicName}`,
    text: [clinicName, '', details, '', instructions, ...links.flatMap(({ label, url }) => ['', label, url]), ''].join(
      '\n',
    ),
    html: [
      '<div style="font:16px/1.6 Figtree, Arial, sans-serif;color:#16241F;background:#FAF8F4;padding:24px">',
      `<h1 style="font:500 28px Fraunces, Georgia, serif;margin:0 0 16px">${escapeHtml(clinicName)}</h1>`,
      `<p>${escapeHtml(details)}</p>`,
      `<p>${instructions}</p>`,
      ...links.map(
        ({ label, url }) =>
          `<p><a style="display:inline-block;line-height:44px;color:#1D5C4B" href="${escapeHtml(url)}">${label}</a></p>`,
      ),
      '</div>',
    ].join('\n'),
  };
}
