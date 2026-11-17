import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

type CalendarBooking = Pick<
  BookingView,
  'id' | 'startsAt' | 'endsAt' | 'updatedAt' | 'rescheduleCount' | 'practitionerName'
>;
type CalendarSettings = Pick<ClinicSettings, 'clinicName' | 'timeZone'>;

function calendarDetails(booking: CalendarBooking, settings: CalendarSettings) {
  return {
    title: `${settings.clinicName} with ${booking.practitionerName}`,
    description: `When: ${formatSlot(booking.startsAt, settings.timeZone)} (${settings.timeZone})\nLength: ${(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes`,
  };
}

/** UTC instants keep imports correct in GMT and BST without a floating local time. */
function calendarTime(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
}

/** iCalendar folds at 75 octets, without splitting a UTF-8 character. */
function foldLine(line: string): string {
  let result = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += size;
  }
  return result;
}

export function bookingCalendar(booking: CalendarBooking, settings: CalendarSettings): string {
  const { title, description } = calendarDetails(booking, settings);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Booking calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${calendarTime(booking.updatedAt)}`,
    `LAST-MODIFIED:${calendarTime(booking.updatedAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `DTSTART:${calendarTime(booking.startsAt)}`,
    `DTEND:${calendarTime(booking.endsAt)}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(settings.clinicName)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(foldLine)
    .join('\r\n');
}

export function calendarLinks(booking: CalendarBooking, settings: CalendarSettings) {
  const { title, description } = calendarDetails(booking, settings);
  const google = new URL('https://calendar.google.com/calendar/render');
  google.search = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${calendarTime(booking.startsAt)}/${calendarTime(booking.endsAt)}`,
    ctz: settings.timeZone,
    details: description,
    location: settings.clinicName,
  }).toString();
  const outlook = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  outlook.search = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: booking.startsAt.toISOString(),
    enddt: booking.endsAt.toISOString(),
    body: description,
    location: settings.clinicName,
  }).toString();
  return { google: google.toString(), outlook: outlook.toString() };
}
