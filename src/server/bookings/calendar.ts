import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

export const BOOKING_CALENDAR_FILENAME = 'booking.ics';
export const BOOKING_CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

type CalendarBooking = Pick<
  BookingView,
  'id' | 'startsAt' | 'endsAt' | 'updatedAt' | 'rescheduleCount' | 'practitionerName'
>;

function calendarTime(instant: Date): string {
  return instant.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function calendarText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
}

// RFC 5545 folds content lines at 75 octets, counting the leading space on continuations.
function foldLine(line: string): string {
  let folded = '';
  let length = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (length + bytes > 75) {
      folded += '\r\n ';
      length = 1;
    }
    folded += character;
    length += bytes;
  }
  return folded;
}

export function bookingCalendar(
  booking: CalendarBooking,
  settings: Pick<ClinicSettings, 'clinicName' | 'timeZone'>,
): string {
  const when = formatSlot(booking.startsAt, settings.timeZone);
  const minutes = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Booking calendar//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${calendarTime(booking.updatedAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `DTSTART:${calendarTime(booking.startsAt)}`,
    `DTEND:${calendarTime(booking.endsAt)}`,
    `SUMMARY:${calendarText(`${settings.clinicName} with ${booking.practitionerName}`)}`,
    `LOCATION:${calendarText(settings.clinicName)}`,
    `DESCRIPTION:${calendarText(`${when} (${settings.timeZone})\n${minutes} minutes`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(foldLine)
    .join('\r\n');
}
