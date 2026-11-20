import { z } from 'zod';

const bookingId = z.uuid();
type BookingAction = 'reschedule' | 'cancel';

export function bookingActionPath(id: string, action: BookingAction): string {
  return `/bookings?booking=${id}&action=${action}`;
}

/** Only these two local booking links may continue after sign-in. */
export function bookingReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\/bookings\?booking=([a-fA-F\d-]+)&action=(reschedule|cancel)$/.exec(value);
  const id = bookingId.safeParse(match?.[1]);
  const action = match?.[2];
  if (id.success && (action === 'reschedule' || action === 'cancel')) return bookingActionPath(id.data, action);
  return undefined;
}

export function bookingSignInPath(returnTo?: string, invalid = false): string {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  if (invalid) params.set('error', 'invalid');
  return params.size ? `/auth/sign-in?${params}` : '/auth/sign-in';
}
