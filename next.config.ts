import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { buildIdentityFromArguments, type BuildIdentity } from './src/lib/build-identity';

function testClockBuildFlag(value: string | undefined): 'true' | 'false' {
  if (value === undefined || value === '' || value === 'false') {
    return 'false';
  }
  if (value === 'true') {
    return 'true';
  }
  throw new Error(`BOOKIT_ALLOW_TEST_CLOCK must be "true" or "false", not "${value}".`);
}

// Only `next build` needs the build arguments; `next start` serves what was
// inlined, and `next dev` runs from source.
function identityFor(phase: string): BuildIdentity {
  if (phase !== PHASE_PRODUCTION_BUILD) {
    return { commit: 'development', buildId: 'local', image: 'none', builtAt: '1970-01-01T00:00:00.000Z' };
  }
  // The build machine's time, used only when BUILT_AT is not given. It is
  // build time, never request time, so the application clock does not apply.
  // eslint-disable-next-line no-restricted-syntax
  return buildIdentityFromArguments(process.env, new Date());
}

export default function nextConfig(phase: string): NextConfig {
  const identity = identityFor(phase);
  return {
    distDir: process.env.BOOKIT_DIST_DIR ?? '.next',
    // Inlined into the build, so a built server cannot be switched to the
    // virtual clock or given another identity by its runtime environment
    // (src/lib/build-flags.ts).
    env: {
      BOOKIT_BUILD_ALLOW_TEST_CLOCK: testClockBuildFlag(process.env.BOOKIT_ALLOW_TEST_CLOCK),
      BOOKIT_BUILD_GIT_COMMIT: identity.commit,
      BOOKIT_BUILD_ID: identity.buildId,
      BOOKIT_BUILD_IMAGE: identity.image,
      BOOKIT_BUILD_BUILT_AT: identity.builtAt,
    },
    poweredByHeader: false,
    reactStrictMode: true,
  };
}
