import { describe, expect, it } from 'vitest';
import { bookingReturnPath } from '@/lib/booking-links';

const BOOKING_ID = '019a0000-1234-7abc-8abc-123456789abc';

describe('booking links after sign-in', () => {
  it('keeps the local reschedule and cancellation destinations', () => {
    expect(bookingReturnPath(`/bookings/${BOOKING_ID}/reschedule`)).toBe(`/bookings/${BOOKING_ID}/reschedule`);
    expect(bookingReturnPath(`/bookings?cancel=${BOOKING_ID}`)).toBe(`/bookings?cancel=${BOOKING_ID}`);
  });

  it('refuses external destinations and paths outside the booking link formats', () => {
    for (const path of [
      `https://example.test/bookings/${BOOKING_ID}/reschedule`,
      `//example.test/bookings/${BOOKING_ID}/reschedule`,
      `/bookings?cancel=${BOOKING_ID}&returnTo=https://example.test`,
      '/bookings/../admin/reschedule',
      '/bookings/not-an-id/reschedule',
      '/admin',
    ]) {
      expect(bookingReturnPath(path), path).toBeUndefined();
    }
  });
});
