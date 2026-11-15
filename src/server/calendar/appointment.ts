import { formatSlot } from '@/lib/time';
import type { BookingView } from '@/server/bookings/queries';
import type { ClinicSettings } from '@/server/settings';

export const CALENDAR_FILENAME = 'appointment.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

function calendarTime(instant: Date): string {
  return instant
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

// RFC 5545 section 3.1: fold at 75 octets without splitting UTF-8 characters.
// https://www.rfc-editor.org/rfc/rfc5545#section-3.1
function foldLine(line: string): string {
  let result = '';
  let length = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (length + bytes > 75) {
      result += '\r\n ';
      length = 1;
    }
    result += character;
    length += bytes;
  }
  return result;
}

/** A private, portable snapshot. UTC instants import correctly through UK clock changes. */
export function appointmentCalendar(booking: BookingView, settings: ClinicSettings): string {
  const description = [
    `With: ${booking.practitionerName}`,
    `When: ${formatSlot(booking.startsAt, settings.timeZone)} (${settings.timeZone})`,
    `Duration: ${(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes`,
    'Check My bookings for the current booking. If you move or cancel, update your calendar too.',
  ].join('\n');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BookIt//Appointments//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${booking.id}@bookit.test`,
      `DTSTAMP:${calendarTime(booking.updatedAt)}`,
      `LAST-MODIFIED:${calendarTime(booking.updatedAt)}`,
      `SEQUENCE:${booking.rescheduleCount}`,
      `DTSTART:${calendarTime(booking.startsAt)}`,
      `DTEND:${calendarTime(booking.endsAt)}`,
      `SUMMARY:${escapeText(`${settings.clinicName} with ${booking.practitionerName}`)}`,
      `LOCATION:${escapeText(settings.clinicName)}`,
      `DESCRIPTION:${escapeText(description)}`,
      'STATUS:CONFIRMED',
      'CLASS:PRIVATE',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(foldLine)
      .join('\r\n') + '\r\n'
  );
}
