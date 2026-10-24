import * as Sentry from '@sentry/nextjs';
import { buildIdentity, testClockAllowedByBuild } from '@/lib/build-flags';
import { runtimeIdentity } from '@/lib/runtime-identity';
import { parseSentryDsn, sentryOptions } from '@/lib/sentry-options';

/**
 * Starts the Sentry SDK when BOOKIT_SENTRY_DSN is set. Errors thrown by
 * routes, pages and server actions reach it through `onRequestError` in
 * src/instrumentation.ts.
 */
export function initErrorReporting(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const dsn = parseSentryDsn(env, testClockAllowedByBuild());
  if (!dsn) {
    return false;
  }
  Sentry.init(sentryOptions(dsn, buildIdentity(), runtimeIdentity(env)));
  return true;
}

/** Reports an error that was handled, so it did not reach `onRequestError`. A no-op without a DSN. */
export function reportError(error: unknown, tags: Record<string, string>, fingerprint?: string[]): void {
  Sentry.captureException(error, { tags, ...(fingerprint ? { fingerprint } : {}) });
}
