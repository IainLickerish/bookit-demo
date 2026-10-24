export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupChecks } = await import('./server/startup');
    runStartupChecks();
  }
}

// Errors thrown by routes, pages and server actions go to Sentry; this is a
// no-op when BOOKIT_SENTRY_DSN is not set (src/server/error-reporting.ts).
export { captureRequestError as onRequestError } from '@sentry/nextjs';
