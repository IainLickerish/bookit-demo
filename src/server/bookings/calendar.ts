import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

export const CALENDAR_FILENAME = 'physiotherapy-session.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

function calendarDate(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function calendarText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[;,]/g, '\\$&');
}

/** Fold at 75 UTF-8 octets without splitting a character (RFC 5545). */
function foldLine(line: string): string {
  let folded = '';
  let bytes = 0;
  for (const character of line) {
    const width = Buffer.byteLength(character);
    if (bytes + width > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += character;
    bytes += width;
  }
  return folded;
}

type CalendarBooking = Pick<
  BookingView,
  'id' | 'updatedAt' | 'rescheduleCount' | 'startsAt' | 'endsAt' | 'practitionerName'
>;

export function bookingCalendar(
  booking: CalendarBooking,
  settings: Pick<ClinicSettings, 'clinicName' | 'timeZone'>,
): string {
  const { clinicName, timeZone } = settings;
  const when = formatSlot(booking.startsAt, timeZone);
  const minutes = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  const title = `${clinicName} session with ${booking.practitionerName}`;
  const description = `When: ${when} (${timeZone})\nLength: ${minutes} minutes`;

  // UTC start and end are unambiguous, including across UK clock changes.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Session calendar//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${calendarDate(booking.updatedAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `DTSTART:${calendarDate(booking.startsAt)}`,
    `DTEND:${calendarDate(booking.endsAt)}`,
    `SUMMARY:${calendarText(title)}`,
    `LOCATION:${calendarText(clinicName)}`,
    `DESCRIPTION:${calendarText(description)}`,
    'CLASS:PRIVATE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(foldLine)
    .join('\r\n');
}
