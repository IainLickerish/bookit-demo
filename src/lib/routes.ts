export const FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const RESET_PASSWORD_PREFIX = '/auth/reset-password/';

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
