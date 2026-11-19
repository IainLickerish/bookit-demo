import { z } from 'zod';

export const FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const RESET_PASSWORD_PREFIX = '/auth/reset-password/';

export function resetPasswordPath(token: string): string {
  return `${RESET_PASSWORD_PREFIX}${encodeURIComponent(token)}`;
}

export function bookingReschedulePath(bookingId: string): string {
  return `/bookings/${bookingId}/reschedule`;
}

export function bookingCancelTarget(bookingId: string): string {
  return `cancel-${bookingId}`;
}

export function bookingCancellationPath(bookingId: string): string {
  return `/bookings?booking=${bookingId}#${bookingCancelTarget(bookingId)}`;
}

/** Only the two booking destinations can be supplied as sign-in return paths. */
export function bookingReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = /^\/bookings[/?](?:booking=)?([a-f0-9-]+)/i.exec(value)?.[1];
  if (!id || !z.uuid().safeParse(id).success) return undefined;
  if (value === bookingReschedulePath(id) || value === bookingCancellationPath(id)) return value;
  return undefined;
}

export function signInPath(returnTo?: string, invalid = false): string {
  const query = new URLSearchParams();
  if (invalid) query.set('error', 'invalid');
  if (returnTo) query.set('returnTo', returnTo);
  return query.size ? `/auth/sign-in?${query}` : '/auth/sign-in';
}

/**
 * A request path as it may appear in logs and error reports: a password
 * reset token in the path is replaced by `[token]`, and any query string is
 * dropped.
 */
export function redactPath(pathWithQuery: string): string {
  const [pathname = ''] = pathWithQuery.split(/[?#]/, 1);
  if (pathname.startsWith(RESET_PASSWORD_PREFIX) && pathname.length > RESET_PASSWORD_PREFIX.length) {
    return `${RESET_PASSWORD_PREFIX}[token]`;
  }
  return pathname;
}

/** `redactPath` for a full URL, keeping the origin. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${redactPath(parsed.pathname)}`;
  } catch {
    return redactPath(url);
  }
}
