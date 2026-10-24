import { NextResponse } from 'next/server';
import { testClockAllowedByBuild } from '@/lib/build-flags';
import { runtimeIdentity } from '@/lib/runtime-identity';
import { injectedErrorEnabled, InjectedTestError } from '@/server/injected-error';

export const dynamic = 'force-dynamic';

/**
 * Throws an error on purpose so tests and the M0 smoke check can see it reach
 * fake-sentry with the product, environment and release. Only test-clock
 * builds and local runs have it; everywhere else it is 404.
 */
export function GET(): NextResponse {
  if (!injectedErrorEnabled(testClockAllowedByBuild(), runtimeIdentity().environment)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  throw new InjectedTestError();
}
