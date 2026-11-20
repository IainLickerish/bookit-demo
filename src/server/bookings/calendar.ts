import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

export const CALENDAR_FILENAME = 'session.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

export function sessionLengthMinutes(booking: Pick<BookingView, 'startsAt' | 'endsAt'>): number {
  return Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
}

function calendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 19).replaceAll(/[-:]/g, '') + 'Z';
}

function calendarText(text: string): string {
  return text.replaceAll(/[\\;,]/g, '\\$&').replaceAll(/\r\n|\r|\n/g, '\\n');
}

/** Fold at 75 bytes, including the leading space on each continuation line. */
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

export function bookingCalendar(
  booking: Pick<BookingView, 'id' | 'updatedAt' | 'rescheduleCount' | 'startsAt' | 'endsAt' | 'practitionerName'>,
  settings: Pick<ClinicSettings, 'clinicName' | 'timeZone'>,
): string {
  const { clinicName, timeZone } = settings;
  const summary = `${clinicName} session with ${booking.practitionerName}`;
  const description = `When: ${formatSlot(booking.startsAt, timeZone)} (${timeZone})\nLength: ${sessionLengthMinutes(booking)} minutes`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Session booking//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${calendarDate(booking.updatedAt)}`,
    `DTSTART:${calendarDate(booking.startsAt)}`,
    `DTEND:${calendarDate(booking.endsAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    'STATUS:CONFIRMED',
    `SUMMARY:${calendarText(summary)}`,
    `LOCATION:${calendarText(clinicName)}`,
    `DESCRIPTION:${calendarText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(foldLine)
    .join('\r\n');
}
