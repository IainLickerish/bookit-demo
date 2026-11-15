import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/db/client';
import * as bookingQueries from '@/server/bookings/queries';
import * as sessionQueries from '@/server/auth/session';
import * as clinicSettings from '@/server/settings';
import * as errorReporting from '@/server/error-reporting';
import { DatabaseError } from '@/server/errors';
import { calendarResponse } from '@/server/calendar/http';
import type { BookingView } from '@/server/bookings/queries';
import * as calendar from '@/server/calendar/appointment';
import { composeConfirmation, sendConfirmation } from '@/server/notifications/confirmation';
import { createSmtpMailer } from '@/server/notifications/mailer';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, startSmtpReceiver, TEST_MAIL_FROM, testMail } from '../helpers/mail';

const booking: BookingView = {
  id: '019a0000-0000-7000-8000-00000000b001',
  patientId: '019a0000-0000-7000-8000-00000000a001',
  status: 'confirmed',
  lateCancellation: false,
  phone: '+44 7700 900001',
  rescheduleCount: 0,
  createdAt: new Date('2026-10-20T07:00:00Z'),
  updatedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  slotId: '019a0000-0000-7000-8000-00000000c001',
  startsAt: new Date('2026-10-22T08:00:00Z'),
  endsAt: new Date('2026-10-22T08:45:00Z'),
  practitionerId: '019a0000-0000-7000-8000-00000000d001',
  practitionerName: 'Zoë Physiotherapist',
};
const settings = TEST_CLINIC_SETTINGS;
const input = {
  booking,
  settings,
  patient: { name: 'Calendar Client', email: 'calendar@patients.example.test' },
  from: TEST_MAIL_FROM,
};
const unfold = (content: string) => content.replace(/\r\n /g, '');

afterEach(() => vi.restoreAllMocks());

describe('portable appointment calendar', () => {
  it.each([
    ['2026-10-22T08:00:00Z', '2026-10-22T08:45:00Z', 'Thu\\, 22 Oct 2026\\, 09:00'],
    ['2026-10-26T09:00:00Z', '2026-10-26T09:45:00Z', 'Mon\\, 26 Oct 2026\\, 09:00'],
    ['2027-03-27T09:00:00Z', '2027-03-27T09:45:00Z', 'Sat\\, 27 Mar 2027\\, 09:00'],
    ['2027-03-29T08:00:00Z', '2027-03-29T08:45:00Z', 'Mon\\, 29 Mar 2027\\, 09:00'],
  ])('keeps the saved instant and full duration across UK clock changes: %s', (start, end, local) => {
    const result = unfold(
      calendar.appointmentCalendar(
        { ...booking, startsAt: new Date(start), endsAt: new Date(end) },
        { ...settings, sessionMinutes: 30 },
      ),
    );
    expect(result).toContain(`DTSTART:${start.replace(/[-:]/g, '')}\r\n`);
    expect(result).toContain(`DTEND:${end.replace(/[-:]/g, '')}\r\n`);
    expect(result).toContain(`When: ${local} (Europe/London)`);
    expect(result).toContain('Duration: 45 minutes');
    expect(result).toContain(`SUMMARY:${settings.clinicName} with Zoë Physiotherapist`);
    expect(result).toContain(`LOCATION:${settings.clinicName}`);
    expect(result).not.toContain(booking.phone);
    expect(result).not.toContain(booking.patientId);
    expect(result).not.toContain(input.patient.name);
    expect(result).not.toContain(input.patient.email);
  });

  it('escapes property injection and folds long Unicode lines by bytes with CRLF endings', () => {
    const clinicName = 'Clinique, santé; \\ '.repeat(12) + '\r\nBEGIN:VEVENT';
    const content = calendar.appointmentCalendar(
      { ...booking, practitionerName: 'Zoë\nATTENDEE:intruder' },
      { ...settings, clinicName },
    );
    const lines = content.split('\r\n');
    expect(lines.at(-1)).toBe('');
    for (const line of lines) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(content).not.toContain('\uFFFD');
    const decoded = unfold(content);
    expect(decoded.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    expect(decoded).toContain('Clinique\\, santé\\; \\\\ ');
    expect(decoded).toContain('\\nBEGIN:VEVENT');
    expect(decoded).not.toMatch(/^ATTENDEE:/m);
    expect(content.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('keeps one event identity after a move while changing its times and sequence', () => {
    const moved = {
      ...booking,
      startsAt: new Date('2026-11-02T11:00:00Z'),
      endsAt: new Date('2026-11-02T12:30:00Z'),
      updatedAt: new Date('2026-10-21T10:00:00Z'),
      rescheduleCount: 1,
    };
    const before = unfold(calendar.appointmentCalendar(booking, settings));
    const after = unfold(calendar.appointmentCalendar(moved, settings));
    expect(after.match(/^UID:.+$/m)?.[0]).toBe(before.match(/^UID:.+$/m)?.[0]);
    expect(after).toContain('SEQUENCE:1\r\n');
    expect(after).toContain('DTSTART:20261102T110000Z');
    expect(after).toContain('DTEND:20261102T123000Z');
    expect(after).toContain('LAST-MODIFIED:20261021T100000Z');
    expect(after).toContain('Duration: 90 minutes');
  });
});

describe('calendar confirmation delivery', () => {
  it.each([false, true])('attaches the saved appointment to booking or move mail (moved=%s)', (moved) => {
    const email = composeConfirmation({ ...input, moved });
    expect(email.text.startsWith(settings.clinicName)).toBe(true);
    expect(email.subject).toContain(moved ? 'rescheduled' : 'confirmed');
    expect(email.attachments).toEqual([
      {
        filename: 'appointment.ics',
        contentType: 'text/calendar; charset=utf-8',
        content: calendar.appointmentCalendar(booking, settings),
      },
    ]);
  });

  it('contains a downloadable UTF-8 calendar attachment through the real SMTP transport', async () => {
    const receiver = await startSmtpReceiver();
    try {
      await createSmtpMailer(receiver.url).send(composeConfirmation(input));
      const raw = receiver.messages[0]!.raw;
      expect(raw).toContain('Content-Type: text/calendar; charset=utf-8');
      expect(raw).toContain('Content-Disposition: attachment; filename=appointment.ics');
      const encoded =
        /Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment[^]*?\r\n\r\n([^]*?)\r\n--/.exec(raw)?.[1];
      expect(encoded).toBeDefined();
      expect(Buffer.from(encoded!, 'base64').toString('utf8')).toBe(calendar.appointmentCalendar(booking, settings));
    } finally {
      await receiver.stop();
    }
  });

  it('contains calendar generation failure after the booking has been saved', async () => {
    const logs = captureLogs(manualClock('2026-10-20T07:00:00Z'));
    const mailer = recordingMailer();
    vi.spyOn(calendar, 'appointmentCalendar').mockImplementation(() => {
      throw new Error('Calendar failed');
    });
    await expect(sendConfirmation(input, testMail(mailer), logs.log)).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(0);
    expect(logs.events()).toContain('email.confirmation.failed');
    expect(JSON.stringify(logs.lines)).not.toMatch(/patients\.example\.test|7700|Calendar Client/);
  });
});

describe('calendar download failure reporting', () => {
  const deps = () => ({
    db: {} as Database,
    clock: manualClock('2026-10-20T07:00:00Z'),
    log: captureLogs(manualClock('2026-10-20T07:00:00Z')).log,
  });
  beforeEach(() => {
    vi.spyOn(sessionQueries, 'findSessionUser').mockResolvedValue({
      ...input.patient,
      id: booking.patientId,
      phone: null,
      role: 'patient',
    });
    vi.spyOn(bookingQueries, 'findBookingForPatient').mockResolvedValue(booking);
    vi.spyOn(clinicSettings, 'loadClinicSettings').mockResolvedValue(settings);
    vi.spyOn(errorReporting, 'reportError').mockImplementation(() => {});
  });

  it('reports generator failures with their code stack but no message, causes or calendar contents', async () => {
    const privateText = `Calendar Client, calendar@patients.example.test, +44 7700 900001\n${calendar.appointmentCalendar(booking, settings)}`;
    const failure = Object.assign(new RangeError(privateText, { cause: new Error(privateText) }), {
      calendar: privateText,
    });
    vi.spyOn(calendar, 'appointmentCalendar').mockImplementation(() => {
      throw failure;
    });
    const dependencies = deps();
    const logs = captureLogs(dependencies.clock);
    const response = await calendarResponse({ ...dependencies, log: logs.log }, 'private-session-token', booking.id);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/bookings?error=calendar_unavailable');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(errorReporting.reportError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      operation: 'calendar.download',
    });
    const reported = vi.mocked(errorReporting.reportError).mock.calls[0]![0] as Error;
    expect(reported.message).toBe('Calendar download failed');
    expect(reported.stack).toContain('calendar.test.ts:');
    expect(reported.stack).toBe(
      `Error: Calendar download failed${failure.stack!.slice(`${failure.name}: ${failure.message}`.length)}`,
    );
    expect(reported).not.toHaveProperty('cause');
    expect(reported).not.toHaveProperty('calendar');
    expect(`${reported.stack} ${JSON.stringify(reported)} ${JSON.stringify(logs.lines)}`).not.toMatch(
      /Calendar Client|calendar@|7700|BEGIN:VCALENDAR|private-session-token/,
    );
    expect(await response.text()).toBe('');
  });

  it.each(['session', 'booking', 'settings'] as const)(
    'reports %s database failures without queries, parameters or provider details',
    async (stage) => {
      const privateText = 'calendar@patients.example.test +44 7700 900001 private-session-token';
      const cause = Object.assign(new Error(privateText), { code: '08006', detail: privateText });
      const failure = new DrizzleQueryError('select * from booking where phone = $1', [privateText], cause);
      const fail = () => {
        throw failure;
      };
      if (stage === 'session') vi.mocked(sessionQueries.findSessionUser).mockImplementation(fail);
      if (stage === 'booking') vi.mocked(bookingQueries.findBookingForPatient).mockImplementation(fail);
      if (stage === 'settings') vi.mocked(clinicSettings.loadClinicSettings).mockImplementation(fail);
      const response = await calendarResponse(deps(), 'private-session-token', booking.id);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/bookings?error=calendar_unavailable');
      expect(errorReporting.reportError).toHaveBeenCalledExactlyOnceWith(expect.any(DatabaseError), {
        operation: 'calendar.download',
      });
      const reported = vi.mocked(errorReporting.reportError).mock.calls[0]![0] as DatabaseError;
      expect(reported.code).toBe('08006');
      expect(reported.stack).toContain('DatabaseError: Database error 08006');
      expect(reported).not.toHaveProperty('cause');
      expect(`${reported.stack} ${JSON.stringify(reported)}`).not.toMatch(
        /patients.example.test|7700|private-session-token|select \*|where phone/,
      );
      expect(await response.text()).toBe('');
    },
  );

  it('handles non-Error failures without forwarding their values', async () => {
    vi.spyOn(calendar, 'appointmentCalendar').mockImplementation(() => {
      throw { calendar: 'BEGIN:VCALENDAR', token: 'private-session-token' };
    });
    const response = await calendarResponse(deps(), 'private-session-token', booking.id);
    expect(response.status).toBe(303);
    const reported = vi.mocked(errorReporting.reportError).mock.calls[0]![0] as Error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported.stack).toContain('Calendar download failed');
    expect(JSON.stringify(reported)).not.toMatch(/BEGIN:VCALENDAR|private-session-token/);
  });
});
