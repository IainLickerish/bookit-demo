import { formatSlot } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import type { BookingView } from './queries';

function calendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** RFC 5545 content lines are at most 75 UTF-8 octets, including continuation space. */
function foldLine(line: string): string {
  const parts: string[] = [];
  let part = '';
  let size = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (size + bytes > 75) {
      parts.push(part);
      part = ' ';
      size = 1;
    }
    part += character;
    size += bytes;
  }
  parts.push(part);
  return parts.join('\r\n');
}

function calendarInstant(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * A portable calendar import, without patient details or scheduling messages.
 * RFC 5545 section 3.7.2: omitting METHOD makes this a snapshot for manual import.
 * https://www.rfc-editor.org/rfc/rfc5545.html#section-3.7.2
 */
export function bookingCalendar(booking: BookingView, settings: ClinicSettings): string {
  const duration = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  const description = [
    `With: ${booking.practitionerName}`,
    `When: ${formatSlot(booking.startsAt, settings.timeZone)} (${settings.timeZone})`,
    `Duration: ${duration} minutes`,
  ].join('\n');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BookIt//Booking calendar//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${booking.id}@bookit.test`,
      `DTSTAMP:${calendarInstant(booking.updatedAt)}`,
      `LAST-MODIFIED:${calendarInstant(booking.updatedAt)}`,
      `SEQUENCE:${booking.rescheduleCount}`,
      // UTC instants preserve the booked UK time across BST/GMT changes in all calendars.
      `DTSTART:${calendarInstant(booking.startsAt)}`,
      `DTEND:${calendarInstant(booking.endsAt)}`,
      `SUMMARY:${calendarText(`${settings.clinicName} with ${booking.practitionerName}`)}`,
      `LOCATION:${calendarText(settings.clinicName)}`,
      `DESCRIPTION:${calendarText(description)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(foldLine)
      .join('\r\n') + '\r\n'
  );
}
