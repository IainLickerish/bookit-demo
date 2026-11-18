export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupChecks } = await import('./server/startup');
    runStartupChecks();
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { startBookingReminderSchedule } = await import('./server/notifications/reminder-schedule');
      startBookingReminderSchedule();
    }
  }
}

// Errors thrown by routes, pages and server actions go to Sentry; this is a
// no-op when BOOKIT_SENTRY_DSN is not set (src/server/error-reporting.ts).
export { captureRequestError as onRequestError } from '@sentry/nextjs';
