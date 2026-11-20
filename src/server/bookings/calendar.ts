import type { BookingView } from './queries';

export const CALENDAR_FILENAME = 'session.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function calendarText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

/** iCalendar lines fold at 75 UTF-8 bytes, including the continuation space. */
function foldLine(line: string): string {
  let folded = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += character;
    bytes += size;
  }
  return folded;
}

export function bookingCalendar(booking: BookingView, clinicName: string): string {
  const summary = `${clinicName}: session with ${booking.practitionerName}`;
  // The slot already represents the clinic's local time as an exact UTC instant.
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
    `SUMMARY:${calendarText(summary)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(foldLine)
    .join('\r\n');
}
