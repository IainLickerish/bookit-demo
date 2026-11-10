import { formatLocalTime, localDateOf } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
}

// iCalendar lines are limited to 75 octets, including the continuation space.
function fold(line: string): string {
  const lines: string[] = [];
  let current = '';
  for (const character of line) {
    if (Buffer.byteLength(current + character, 'utf8') > 75) {
      lines.push(current);
      current = ' ';
    }
    current += character;
  }
  return [...lines, current].join('\r\n');
}

export function calendarDetails(booking: BookingView, settings: ClinicSettings) {
  const duration = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  const date = localDateOf(booking.startsAt, settings.timeZone);
  const time = formatLocalTime(booking.startsAt, settings.timeZone);
  return {
    title: `${settings.clinicName} appointment with ${booking.practitionerName}`,
    description: `With: ${booking.practitionerName}\nWhen: ${date} ${time} (${settings.timeZone})\nLength: ${duration} minutes`,
  };
}

/** UTC instants let calendar apps apply UK summer and winter time correctly. */
export function bookingCalendar(booking: BookingView, settings: ClinicSettings): string {
  const details = calendarDetails(booking, settings);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${stamp(booking.updatedAt)}`,
    `LAST-MODIFIED:${stamp(booking.updatedAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `DTSTART:${stamp(booking.startsAt)}`,
    `DTEND:${stamp(booking.endsAt)}`,
    `SUMMARY:${escapeText(details.title)}`,
    `LOCATION:${escapeText(settings.clinicName)}`,
    `DESCRIPTION:${escapeText(details.description)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}

export function calendarLinks(booking: BookingView, settings: ClinicSettings) {
  const details = calendarDetails(booking, settings);
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: details.title,
    details: details.description,
    location: settings.clinicName,
    dates: `${stamp(booking.startsAt)}/${stamp(booking.endsAt)}`,
    ctz: settings.timeZone,
  });
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: details.title,
    body: details.description,
    location: settings.clinicName,
    startdt: booking.startsAt.toISOString(),
    enddt: booking.endsAt.toISOString(),
  });
  return {
    google: `https://calendar.google.com/calendar/render?${google}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlook}`,
  };
}
