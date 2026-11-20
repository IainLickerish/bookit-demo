export const FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const RESET_PASSWORD_PREFIX = '/auth/reset-password/';

export function rescheduleBookingPath(bookingId: string): string {
  return `/bookings/${bookingId}/reschedule`;
}

export function bookingRowId(bookingId: string): string {
  return `booking-${bookingId}`;
}

const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const bookingDestination = new RegExp(`^/bookings(?:/${UUID}/reschedule|#booking-${UUID})$`);

/** Only the two booking destinations in reminders are valid sign-in redirects. */
export function signInBookingDestination(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = bookingDestination.exec(value);
  return match?.[0] === value ? value : undefined;
}

export function signInPath(options: { next?: string; error?: 'invalid' } = {}): string {
  const query = new URLSearchParams();
  if (options.next) query.set('next', options.next);
  if (options.error) query.set('error', options.error);
  return query.size ? `/auth/sign-in?${query}` : '/auth/sign-in';
}

export function resetPasswordPath(token: string): string {
  return `${RESET_PASSWORD_PREFIX}${encodeURIComponent(token)}`;
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
