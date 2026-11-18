export const FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const RESET_PASSWORD_PREFIX = '/auth/reset-password/';

export function resetPasswordPath(token: string): string {
  return `${RESET_PASSWORD_PREFIX}${encodeURIComponent(token)}`;
}

export function rescheduleBookingPath(bookingId: string): string {
  return `/bookings/${bookingId}/reschedule`;
}

export function bookingAnchor(bookingId: string): string {
  return `booking-${bookingId}`;
}

// Only the two destinations used by booking emails may survive sign-in.
export function bookingSignInDestination(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\/bookings(?:\/[0-9a-f-]{36}\/reschedule|#booking-[0-9a-f-]{36})$/.exec(value);
  return match?.[0] === value ? value : undefined;
}

export function signInPath(next?: string, invalid = false): string {
  const query = new URLSearchParams();
  if (next) query.set('next', next);
  if (invalid) query.set('error', 'invalid');
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
