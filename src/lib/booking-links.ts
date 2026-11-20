import { z } from 'zod';

const bookingId = z.uuid();

export function rescheduleBookingPath(id: string): string {
  return `/bookings/${id}/reschedule`;
}

export function cancelBookingPath(id: string): string {
  return `/bookings?cancel=${id}`;
}

/** Only these two local booking links may continue after sign-in. */
export function bookingReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\/bookings(?:\/([a-f\d-]+)\/reschedule|\?cancel=([a-f\d-]+))$/i.exec(value);
  const id = bookingId.safeParse(match?.[1] ?? match?.[2]);
  if (id.success) return match?.[1] ? rescheduleBookingPath(id.data) : cancelBookingPath(id.data);
  return undefined;
}

export function bookingSignInPath(returnTo?: string, invalid = false): string {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  if (invalid) params.set('error', 'invalid');
  return params.size ? `/auth/sign-in?${params}` : '/auth/sign-in';
}
