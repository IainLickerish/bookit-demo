import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

export const CALENDAR_FILENAME = 'booking.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

function calendarTime(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[;,]/g, '\\$&');
}

/** RFC 5545 content lines are at most 75 UTF-8 octets, including continuation spaces. */
function foldLine(value: string): string {
  let result = '';
  let size = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (size + bytes > 75) {
      result += '\r\n ';
      size = 1;
    }
    result += character;
    size += bytes;
  }
  return result;
}

/** A personal calendar import, with no invitation recipients or client contact details. */
export function bookingCalendar(booking: BookingView, settings: ClinicSettings): string {
  const minutes = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  const description = [
    settings.clinicName,
    `With: ${booking.practitionerName}`,
    `When: ${formatSlot(booking.startsAt, settings.timeZone)} (${settings.timeZone})`,
    `Duration: ${minutes} minutes`,
  ].join('\n');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BookIt//Booking calendar//EN',
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
