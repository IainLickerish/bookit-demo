import { describe, expect, it } from 'vitest';
import { bookingManagementPath, bookingSignInPath, parseBookingLink } from '@/lib/routes';
import { composeReminderEmail } from '@/server/notifications/reminder-email';

const bookingId = '0199fb89-4dc0-729d-a478-6e159cd86546';

describe('session reminder links', () => {
  it('links through sign-in to the reschedule page and the booking’s cancel button', () => {
    const email = composeReminderEmail({
      bookingId,
      startsAt: new Date('2026-10-22T08:00:00Z'),
      practitionerName: 'Pat Physio',
      clinicName: 'Test Physio Clinic',
      timeZone: 'Europe/London',
      publicUrl: new URL('https://clinic.example.test'),
      from: 'noreply@clinic.example.test',
      to: 'patient@clinic.example.test',
    });
    const links = email.text.match(/^https:\/\/\S+$/gm)?.map((link) => new URL(link));
    expect(links).toHaveLength(2);
    expect(
      links?.map((url) => {
        expect(url.origin).toBe('https://clinic.example.test');
        const bookingLink = parseBookingLink(url.searchParams.get('bookingId'), url.searchParams.get('intent'));
        expect(bookingLink).not.toBeNull();
        expect(url.pathname + url.search).toBe(bookingSignInPath(bookingLink));
        return bookingManagementPath(bookingLink!);
      }),
    ).toEqual([`/bookings/${bookingId}/reschedule`, `/bookings#cancel-${bookingId}`]);
  });

  it('accepts only a booking ID and a booking management action at sign-in', () => {
    expect(parseBookingLink(bookingId, 'https://another.example.test')).toBeNull();
    expect(parseBookingLink('//another.example.test', 'reschedule')).toBeNull();
    expect(parseBookingLink(`${bookingId}/../admin`, 'cancel')).toBeNull();
    expect(parseBookingLink(bookingId, ['reschedule', 'cancel'])).toBeNull();
  });
});
