import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

export const CALENDAR_FILENAME = 'physio-session.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

function calendarTime(instant: Date): string {
  return instant.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function calendarText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
}

// Fold at 75 bytes without splitting a UTF-8 character (RFC 5545, section 3.1).
function foldLine(line: string): string {
  let folded = '';
  let lineBytes = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (lineBytes + bytes > 75) {
      folded += '\r\n ';
      lineBytes = 1;
    }
    folded += character;
    lineBytes += bytes;
  }
  return folded;
}

export function bookingCalendar(
  booking: Pick<BookingView, 'id' | 'startsAt' | 'endsAt' | 'updatedAt' | 'practitionerName' | 'rescheduleCount'>,
  { clinicName, timeZone }: Pick<ClinicSettings, 'clinicName' | 'timeZone'>,
): string {
  const minutes = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  const description = [
    `Physiotherapist: ${booking.practitionerName}`,
    `Time at the clinic: ${formatSlot(booking.startsAt, timeZone)} (${timeZone})`,
    `Length: ${minutes} minutes`,
  ].join('\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Session calendar//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${calendarTime(booking.updatedAt)}`,
    `DTSTART:${calendarTime(booking.startsAt)}`,
    `DTEND:${calendarTime(booking.endsAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `SUMMARY:${calendarText(`${clinicName} session with ${booking.practitionerName}`)}`,
    `LOCATION:${calendarText(clinicName)}`,
    `DESCRIPTION:${calendarText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(foldLine)
    .join('\r\n');
}
