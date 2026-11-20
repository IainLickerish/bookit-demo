import { expect, it } from 'vitest';
import { signInBookingDestination, signInPath } from '@/lib/routes';

const id = '0199f2e4-75c0-715e-a2e2-31f54953c64c';

it('keeps the reminder destination when a client needs to try signing in again', () => {
  for (const path of [`/bookings/${id}/reschedule`, `/bookings#booking-${id}`]) {
    expect(signInBookingDestination(path)).toBe(path);
    const retry = new URL(signInPath({ next: path, error: 'invalid' }), 'https://bookit.example.test');
    expect(retry.pathname).toBe('/auth/sign-in');
    expect(retry.searchParams.get('next')).toBe(path);
    expect(retry.searchParams.get('error')).toBe('invalid');
  }
});

it('only accepts the two reminder link destinations after sign-in', () => {
  for (const path of [
    `https://other.example.test/bookings/${id}/reschedule`,
    '//other.example.test',
    '/admin/settings',
    `/bookings/${id}/reschedule?next=/admin`,
    `/bookings/${id}/reschedule\n`,
    [`/bookings/${id}/reschedule`],
  ]) {
    expect(signInBookingDestination(path)).toBeUndefined();
  }
});
