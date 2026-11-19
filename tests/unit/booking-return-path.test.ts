import { expect, it } from 'vitest';
import { bookingReturnPath } from '@/lib/routes';

it('refuses sign-in return paths outside the two booking destinations', () => {
  const id = '0199eab0-29d0-7000-a000-000000000001';
  for (const value of [
    'https://elsewhere.example.test/bookings',
    '//elsewhere.example.test',
    '/admin/settings',
    `/bookings/${id}/reschedule?next=//elsewhere.example.test`,
    `/bookings/${id}/reschedule\n`,
    '/bookings/invalid/reschedule',
    `/bookings?booking=${id}#cancel-another-booking`,
  ]) {
    expect(bookingReturnPath(value)).toBeUndefined();
  }
});
