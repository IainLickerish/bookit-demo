import { describe, expect, it } from 'vitest';
import {
  appointmentMinutes,
  bookingCalendarFile,
  calendarFileName,
  calendarFilePath,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalendarBooking,
} from '@/server/calendar/appointment';

const clinic = { clinicName: 'Test Physio Clinic', timeZone: 'Europe/London' };
const STAMP = new Date('2026-10-20T07:00:00Z');

function booking(startsAt: string, minutes: number, overrides: Partial<CalendarBooking> = {}): CalendarBooking {
  const start = new Date(startsAt);
  return {
    id: '019a0000-0000-7000-8000-00000000b001',
    startsAt: start,
    endsAt: new Date(start.getTime() + minutes * 60_000),
    practitionerName: 'Pat Physio',
    rescheduleCount: 0,
    ...overrides,
  };
}

/** The file's lines with RFC 5545 folding undone. */
function unfolded(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('Add to calendar: the calendar file', () => {
  it('describes the clinic, practitioner, UK time and length of the appointment', () => {
    // 22 October 2026 is British Summer Time: 09:30 UTC is 10:30 in the UK.
    const lines = unfolded(bookingCalendarFile(booking('2026-10-22T09:30:00Z', 45), clinic, STAMP));
    expect(lines).toContain('DTSTART:20261022T093000Z');
    expect(lines).toContain('DTEND:20261022T101500Z');
    expect(lines).toContain('SUMMARY:Appointment with Pat Physio at Test Physio Clinic');
    expect(lines).toContain('LOCATION:Test Physio Clinic');
    const description = lines.find((l) => l.startsWith('DESCRIPTION:'));
    expect(description).toContain('Clinic: Test Physio Clinic\\n');
    expect(description).toContain('With: Pat Physio\\n');
    expect(description).toContain('When: Thu\\, 22 Oct 2026\\, 10:30 (Europe/London)\\n');
    expect(description).toContain('Length: 45 minutes\\n');
    expect(description).toContain('Booking reference: 019a0000-0000-7000-8000-00000000b001');
  });

  it('shows UK winter time for an appointment after the clocks go back', () => {
    // 26 October 2026 is GMT: 09:00 UTC is 09:00 in the UK.
    const ics = unfolded(bookingCalendarFile(booking('2026-10-26T09:00:00Z', 30), clinic, STAMP)).join('\n');
    expect(ics).toContain('DTSTART:20261026T090000Z');
    expect(ics).toContain('DTEND:20261026T093000Z');
    expect(ics).toContain('When: Mon\\, 26 Oct 2026\\, 09:00 (Europe/London)');
    expect(ics).toContain('Length: 30 minutes');
  });

  it('is a valid single-event iCalendar file with CRLF lines of at most 75 octets', () => {
    const ics = bookingCalendarFile(
      booking('2026-10-22T09:30:00Z', 45, { practitionerName: 'Siobhán Ó Briain-Ní Mhurchú, Senior Physiotherapist' }),
      clinic,
      STAMP,
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(unfolded(ics)).toContain(
      'SUMMARY:Appointment with Siobhán Ó Briain-Ní Mhurchú\\, Senior Physiotherapist at Test Physio Clinic',
    );
    expect(unfolded(ics)).toContain('DTSTAMP:20261020T070000Z');
  });

  it('keeps the same UID when an appointment moves, with a higher SEQUENCE', () => {
    const first = unfolded(bookingCalendarFile(booking('2026-10-22T09:30:00Z', 45), clinic, STAMP));
    const moved = unfolded(
      bookingCalendarFile(booking('2026-10-27T14:15:00Z', 45, { rescheduleCount: 1 }), clinic, STAMP),
    );
    const uid = (lines: string[]) => lines.find((l) => l.startsWith('UID:'));
    expect(uid(first)).toBe('UID:booking-019a0000-0000-7000-8000-00000000b001@bookit');
    expect(uid(moved)).toBe(uid(first));
    expect(first).toContain('SEQUENCE:0');
    expect(moved).toContain('SEQUENCE:1');
  });

  it('escapes calendar text so names cannot break the file', () => {
    const ics = unfolded(
      bookingCalendarFile(
        booking('2026-10-22T09:30:00Z', 45, { practitionerName: 'A; B\\C\nEND:VEVENT' }),
        clinic,
        STAMP,
      ),
    );
    expect(ics.filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(ics).toContain('SUMMARY:Appointment with A\\; B\\\\C\\nEND:VEVENT at Test Physio Clinic');
  });

  it('names the file after the appointment date in the clinic time zone', () => {
    // 23:30 UTC on 31 October is still 31 October in the UK (GMT).
    expect(calendarFileName(booking('2026-10-31T23:30:00Z', 45), clinic)).toBe('appointment-2026-10-31.ics');
    // 23:30 UTC on 30 June is 1 July in the UK (BST).
    expect(calendarFileName(booking('2026-06-30T23:30:00Z', 45), clinic)).toBe('appointment-2026-07-01.ics');
  });

  it('measures the length from the booked slot', () => {
    expect(appointmentMinutes(booking('2026-10-22T09:30:00Z', 45))).toBe(45);
  });
});

describe('Add to calendar: Google and Outlook links', () => {
  const appointment = booking('2026-10-22T09:30:00Z', 45);

  it('fills in Google Calendar with the UTC start and end and the clinic time zone', () => {
    const url = new URL(googleCalendarUrl(appointment, clinic));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261022T093000Z/20261022T101500Z');
    expect(url.searchParams.get('ctz')).toBe('Europe/London');
    expect(url.searchParams.get('text')).toBe('Appointment with Pat Physio at Test Physio Clinic');
    expect(url.searchParams.get('location')).toBe('Test Physio Clinic');
    expect(url.searchParams.get('details')).toContain('Length: 45 minutes');
  });

  it('fills in Outlook with the UTC start and end', () => {
    const url = new URL(outlookCalendarUrl(appointment, clinic));
    expect(url.origin).toBe('https://outlook.live.com');
    expect(url.searchParams.get('startdt')).toBe('2026-10-22T09:30:00.000Z');
    expect(url.searchParams.get('enddt')).toBe('2026-10-22T10:15:00.000Z');
    expect(url.searchParams.get('subject')).toBe('Appointment with Pat Physio at Test Physio Clinic');
    expect(url.searchParams.get('body')).toContain('When: Thu, 22 Oct 2026, 10:30 (Europe/London)');
  });

  it('downloads the calendar file from the booking’s own path', () => {
    expect(calendarFilePath(appointment.id)).toBe('/bookings/019a0000-0000-7000-8000-00000000b001/calendar');
  });
});
