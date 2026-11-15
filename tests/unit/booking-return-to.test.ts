import { describe, expect, it } from 'vitest';
import { bookingReturnTo } from '@/lib/booking-paths';
const id = '019a0000-0000-7000-8000-000000000001';
const slot = '019a0000-0000-7000-8000-000000000002';
describe('reminder sign-in destinations', () => {
  it.each([`/bookings/${id}/cancel`, `/bookings/${id}/reschedule`, `/bookings/${id}/reschedule/${slot}`])(
    'accepts the booking path %s',
    (path) => {
      expect(bookingReturnTo(path)).toBe(path);
    },
  );
  it.each([
    null,
    '',
    '//other.example.test',
    'https://other.example.test',
    '/admin',
    '/bookings',
    `/bookings/${id}/cancel?next=https://other.example.test`,
    `/bookings/${id}/cancel#fragment`,
    `/bookings/${id}/cancel\n`,
    `/bookings/${id}/cancel\r\nLocation: /admin`,
    `/bookings/${id}/reschedule/%2f%2fother.example.test`,
    `/bookings/${id}/../admin`,
    `/bookings/${id}\\cancel`,
    '/bookings/not-an-id/cancel',
  ])('refuses arbitrary or malformed destinations %j', (path) => {
    expect(bookingReturnTo(path)).toBeNull();
  });
});
