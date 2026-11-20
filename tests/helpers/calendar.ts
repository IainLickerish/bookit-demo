import { expect } from 'vitest';

/** Checks the calendar envelope and returns the unfolded lines of its one event. */
export function expectCalendarEvent(file: string, bookingId: string): string {
  const lines = file.replaceAll('\r\n ', '').split('\r\n');
  expect(lines.slice(0, 4)).toEqual([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    expect.stringMatching(/^PRODID:.+$/),
    'BEGIN:VEVENT',
  ]);
  expect(lines.slice(-3)).toEqual(['END:VEVENT', 'END:VCALENDAR', '']);

  const event = lines.slice(4, -3);
  expect(event.filter((line) => /^(BEGIN|END):/.test(line))).toEqual([]);
  expect(event.filter((line) => line.startsWith('UID:'))).toEqual([`UID:${bookingId}@bookit.test`]);
  for (const field of ['DTSTAMP', 'DTSTART', 'DTEND']) {
    expect(event.filter((line) => line.startsWith(`${field}:`))).toEqual([
      expect.stringMatching(new RegExp(`^${field}:\\d{8}T\\d{6}Z$`)),
    ]);
  }
  return event.join('\r\n') + '\r\n';
}
