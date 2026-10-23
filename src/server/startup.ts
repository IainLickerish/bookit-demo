import { resolveClock } from '@/lib/clock';
import { testClockAllowedByBuild } from '@/lib/build-flags';

/**
 * Checks the configuration a server is starting with and throws if it must
 * not start. A build made without BOOKIT_ALLOW_TEST_CLOCK=true refuses
 * BOOKIT_TEST_CLOCK; a test-clock build checks the clock file is readable.
 */
export function checkStartupConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
  allowTestClock: boolean = testClockAllowedByBuild(),
): void {
  resolveClock(env, allowTestClock).now();
}

/** Stops the process when the start-up configuration is refused. */
export function runStartupChecks(): void {
  try {
    checkStartupConfiguration();
  } catch (error) {
    // The logger reads the clock, which may be what failed, so the refusal is
    // written directly. Messages name variables and paths, never values.
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ level: 'fatal', service: 'bookit', event: 'startup.refused', reason })}\n`,
    );
    process.exit(1);
  }
}
