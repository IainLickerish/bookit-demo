import { describe, expect, it } from 'vitest';
import { pathInManifest, routeManifest } from '@/lib/route-manifest';
import { formatAppointmentTime } from '@/lib/time';
import { reminderSweepSeconds, ReminderScheduleError } from '@/server/notifications/reminder-scheduler';
import { cancelPath, composeReminder, reschedulePath } from '@/server/notifications/reminder';
import { TEST_MAIL_FROM } from '../helpers/mail';

const BOOKING_ID = '019a0000-0000-7000-8000-00000000b001';

function reminder(startsAt: string) {
  return composeReminder({
    booking: { id: BOOKING_ID, startsAt: new Date(startsAt), practitionerName: 'Pat Physio' },
    patient: { email: 'patient1@patients.example.test', name: 'Pat One' },
    settings: { clinicName: 'Test Physio Clinic', timeZone: 'Europe/London' },
    publicUrl: new URL('https://acme.example.test'),
    from: TEST_MAIL_FROM,
  });
}

describe('appointment reminder email', () => {
  it('has the date, UK time, practitioner and links to reschedule or cancel', () => {
    const email = reminder('2026-10-22T09:30:00Z');
    expect(email).toMatchObject({
      from: TEST_MAIL_FROM,
      to: 'patient1@patients.example.test',
      subject: 'Reminder: your appointment on Thursday 22 October 2026 at 10:30 (UK time)',
    });
    expect(email.text).toContain('When: Thursday 22 October 2026 at 10:30 (UK time)\n');
    expect(email.text).toContain('With: Pat Physio\n');
    expect(email.text).toContain(`Booking reference: ${BOOKING_ID}\n`);
    expect(email.text).toContain(`To reschedule:\nhttps://acme.example.test/bookings/${BOOKING_ID}/reschedule\n`);
    expect(email.text).toContain(`To cancel:\nhttps://acme.example.test/bookings/${BOOKING_ID}/cancel\n`);
  });

  it('shows the wall-clock time on the appointment date, across a clock change', () => {
    // Clocks go back on 25 October 2026: 10:30 on 26 October is 10:30 GMT.
    expect(formatAppointmentTime(new Date('2026-10-26T10:30:00Z'), 'Europe/London')).toBe(
      'Monday 26 October 2026 at 10:30 (UK time)',
    );
    expect(formatAppointmentTime(new Date('2026-10-24T09:30:00Z'), 'Europe/London')).toBe(
      'Saturday 24 October 2026 at 10:30 (UK time)',
    );
    expect(formatAppointmentTime(new Date('2026-10-24T09:30:00Z'), 'Europe/Paris')).toBe(
      'Saturday 24 October 2026 at 11:30 (Europe/Paris)',
    );
  });

  it('links only to pages the app serves', () => {
    const manifest = routeManifest();
    expect(pathInManifest(reschedulePath(BOOKING_ID), manifest)).toBe(true);
    expect(pathInManifest(cancelPath(BOOKING_ID), manifest)).toBe(true);
  });
});

describe('reminder sweep interval', () => {
  it('defaults to five minutes, accepts 0 to switch it off, and refuses anything else', () => {
    expect(reminderSweepSeconds({})).toBe(300);
    expect(reminderSweepSeconds({ BOOKIT_REMINDER_SWEEP_SECONDS: '0' })).toBe(0);
    expect(reminderSweepSeconds({ BOOKIT_REMINDER_SWEEP_SECONDS: '60' })).toBe(60);
    for (const bad of ['-1', '1.5', 'often', '3601']) {
      expect(() => reminderSweepSeconds({ BOOKIT_REMINDER_SWEEP_SECONDS: bad })).toThrow(ReminderScheduleError);
    }
  });
});
