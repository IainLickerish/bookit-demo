import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

export const BOOKING_CALENDAR_FILENAME = 'physio-session.ics';
export const BOOKING_CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

type CalendarBooking = Pick<
  BookingView,
  'id' | 'practitionerName' | 'startsAt' | 'endsAt' | 'updatedAt' | 'rescheduleCount'
>;

function calendarDate(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function calendarText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

/** Fold iCalendar content lines at 75 bytes, including the continuation space. */
function foldLine(line: string): string {
  let folded = '';
  let bytes = 0;
  for (const character of line) {
    const length = Buffer.byteLength(character);
    if (bytes + length > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += character;
    bytes += length;
  }
  return folded;
}

export function bookingCalendar(
  booking: CalendarBooking,
  settings: Pick<ClinicSettings, 'clinicName' | 'timeZone'>,
): string {
  const { clinicName, timeZone } = settings;
  const when = formatSlot(booking.startsAt, timeZone);
  const minutes = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Booking Calendar//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@bookit.test`,
    `DTSTAMP:${calendarDate(booking.updatedAt)}`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `DTSTART:${calendarDate(booking.startsAt)}`,
    `DTEND:${calendarDate(booking.endsAt)}`,
    `SUMMARY:${calendarText(`${clinicName} session with ${booking.practitionerName}`)}`,
    `LOCATION:${calendarText(clinicName)}`,
    `DESCRIPTION:${calendarText(`${when} (${timeZone})\n${minutes} minutes`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
