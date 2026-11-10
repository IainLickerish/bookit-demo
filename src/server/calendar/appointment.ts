import { formatSlot } from '@/lib/time';
import type { BookingView } from '../bookings/queries';
import type { ClinicSettings } from '../settings';

// "Add to calendar" for a patient's own appointment (Google, Outlook, Apple).
// Every time here is the slot's UTC instant: calendar apps convert it to the
// device's zone, so a UK patient sees UK time on both sides of a clock change.

export type CalendarBooking = Pick<BookingView, 'id' | 'startsAt' | 'endsAt' | 'practitionerName' | 'rescheduleCount'>;

export type CalendarClinic = Pick<ClinicSettings, 'clinicName' | 'timeZone'>;

const MINUTE_MS = 60_000;

export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8; method=PUBLISH';

/** The appointment's length in whole minutes, from the booked slot. */
export function appointmentMinutes(booking: Pick<BookingView, 'startsAt' | 'endsAt'>): number {
  return Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE_MS);
}

export function appointmentTitle(booking: CalendarBooking, clinic: CalendarClinic): string {
  return `Appointment with ${booking.practitionerName} at ${clinic.clinicName}`;
}

/** The plain-text notes shown in the calendar entry. */
export function appointmentNotes(booking: CalendarBooking, clinic: CalendarClinic): string {
  return [
    `Clinic: ${clinic.clinicName}`,
    `With: ${booking.practitionerName}`,
    `When: ${formatSlot(booking.startsAt, clinic.timeZone)} (${clinic.timeZone})`,
    `Length: ${appointmentMinutes(booking)} minutes`,
    `Booking reference: ${booking.id}`,
    '',
    'To cancel or reschedule, sign in to BookIt and open My bookings.',
  ].join('\n');
}

/** `20261023T080000Z`: an iCalendar UTC date-time. */
function icsInstant(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** RFC 5545 section 3.3.11 TEXT escaping. */
function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const MAX_LINE_OCTETS = 75;

/** RFC 5545 section 3.1: lines longer than 75 octets continue after CRLF and a space, never mid-character. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * A one-event iCalendar file for the booking. The UID stays the same when
 * the appointment moves and SEQUENCE counts the moves, so calendar apps that
 * honour them update the existing entry rather than adding a second one.
 */
export function bookingCalendarFile(booking: CalendarBooking, clinic: CalendarClinic, stamp: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookIt//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@bookit`,
    `SEQUENCE:${booking.rescheduleCount}`,
    `DTSTAMP:${icsInstant(stamp)}`,
    `DTSTART:${icsInstant(booking.startsAt)}`,
    `DTEND:${icsInstant(booking.endsAt)}`,
    `SUMMARY:${icsText(appointmentTitle(booking, clinic))}`,
    `LOCATION:${icsText(clinic.clinicName)}`,
    `DESCRIPTION:${icsText(appointmentNotes(booking, clinic))}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function calendarFileName(booking: Pick<BookingView, 'startsAt'>, clinic: CalendarClinic): string {
  return `appointment-${formatSlotDate(booking.startsAt, clinic.timeZone)}.ics`;
}

function formatSlotDate(instant: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

/** Opens Google Calendar's "new event" form, filled in. Nothing is sent until the patient clicks. */
export function googleCalendarUrl(booking: CalendarBooking, clinic: CalendarClinic): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: appointmentTitle(booking, clinic),
    dates: `${icsInstant(booking.startsAt)}/${icsInstant(booking.endsAt)}`,
    details: appointmentNotes(booking, clinic),
    location: clinic.clinicName,
    ctz: clinic.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Opens Outlook on the web's "new event" form, filled in. */
export function outlookCalendarUrl(booking: CalendarBooking, clinic: CalendarClinic): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: appointmentTitle(booking, clinic),
    startdt: booking.startsAt.toISOString(),
    enddt: booking.endsAt.toISOString(),
    body: appointmentNotes(booking, clinic),
    location: clinic.clinicName,
  });
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

/** The download link for the booking's calendar file (Apple Calendar, Outlook desktop and others). */
export function calendarFilePath(bookingId: string): string {
  return `/bookings/${encodeURIComponent(bookingId)}/calendar`;
}
