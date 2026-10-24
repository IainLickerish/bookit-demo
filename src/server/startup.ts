import { buildIdentity, testClockAllowedByBuild } from '@/lib/build-flags';
import { FULL_COMMIT_SHA, type BuildIdentity } from '@/lib/build-identity';
import { getClock, resolveClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import {
  publicBaseUrl,
  RuntimeConfigurationError,
  runtimeIdentity,
  type RuntimeIdentity,
} from '@/lib/runtime-identity';
import { parseSentryDsn } from '@/lib/sentry-options';
import { initErrorReporting } from './error-reporting';
import { recordStartedAt } from './version';

/**
 * Checks the configuration a server is starting with and throws if it must
 * not start:
 * - a build made without BOOKIT_ALLOW_TEST_CLOCK=true refuses
 *   BOOKIT_TEST_CLOCK, and a test-clock build checks the clock file is
 *   readable (plan 12.8);
 * - BOOKIT_ENV must be local, staging or production, and outside local the
 *   build must carry a full commit SHA and the container a product and tenant
 *   (plan 12.6);
 * - BOOKIT_PUBLIC_URL, the origin used in email links, must be set outside
 *   local runs;
 * - BOOKIT_SENTRY_DSN, when set, must be a DSN, and a local receiver in a
 *   test-clock build.
 */
export function checkStartupConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
  allowTestClock: boolean = testClockAllowedByBuild(),
  build: BuildIdentity = buildIdentity(),
): RuntimeIdentity {
  resolveClock(env, allowTestClock).now();
  const runtime = runtimeIdentity(env);
  if (runtime.environment !== 'local' && !FULL_COMMIT_SHA.test(build.commit)) {
    throw new RuntimeConfigurationError(
      `GIT_COMMIT must be a 40-character commit SHA when BOOKIT_ENV is ${runtime.environment}; this build was made without one.`,
    );
  }
  publicBaseUrl(env);
  parseSentryDsn(env, allowTestClock);
  return runtime;
}

/** Stops the process when the start-up configuration is refused. */
export function runStartupChecks(): void {
  let runtime: RuntimeIdentity;
  try {
    runtime = checkStartupConfiguration();
  } catch (error) {
    // The logger reads the clock, which may be what failed, so the refusal is
    // written directly. Messages name variables and paths, never values.
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ level: 'fatal', service: 'bookit', event: 'startup.refused', reason })}\n`,
    );
    process.exit(1);
  }
  recordStartedAt(getClock().now());
  const errorReporting = initErrorReporting();
  getLogger().info(
    {
      event: 'startup.ready',
      deployment_id: runtime.deploymentId,
      build_id: buildIdentity().buildId,
      error_reporting: errorReporting,
    },
    'BookIt started',
  );
}
