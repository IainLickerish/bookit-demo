import { describe, expect, it } from 'vitest';
import { bookingReturnPath } from '@/lib/booking-links';

const BOOKING_ID = '019a0000-1234-7abc-8abc-123456789abc';

describe('booking links after sign-in', () => {
  it('keeps both My bookings destinations', () => {
    const reschedule = `/bookings?booking=${BOOKING_ID}&action=reschedule`;
    const cancel = `/bookings?booking=${BOOKING_ID}&action=cancel`;
    expect(bookingReturnPath(reschedule)).toBe(reschedule);
    expect(bookingReturnPath(cancel)).toBe(cancel);
  });

  it('refuses external destinations and paths outside the booking link formats', () => {
    for (const path of [
      `https://example.test/bookings?booking=${BOOKING_ID}&action=reschedule`,
      `//example.test/bookings?booking=${BOOKING_ID}&action=reschedule`,
      `/bookings?booking=${BOOKING_ID}&action=cancel&returnTo=https://example.test`,
      `/bookings?booking=${BOOKING_ID}&action=delete`,
      '/bookings?booking=not-an-id&action=reschedule',
      '/admin',
    ]) {
      expect(bookingReturnPath(path), path).toBeUndefined();
    }
  });
});
