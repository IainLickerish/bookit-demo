import type { BuildIdentity } from './build-identity';

// next.config.ts inlines the BOOKIT_BUILD_* variables at build time from the
// build arguments, so setting any of them when a built server starts has no
// effect. Keep the literal `process.env.X` accesses: destructuring or dynamic
// access defeats the inlining.
export function testClockAllowedByBuild(): boolean {
  return process.env.BOOKIT_BUILD_ALLOW_TEST_CLOCK === 'true';
}

/** The identity this build was made with; empty strings outside a Next.js build. */
export function buildIdentity(): BuildIdentity {
  return {
    commit: process.env.BOOKIT_BUILD_GIT_COMMIT ?? '',
    buildId: process.env.BOOKIT_BUILD_ID ?? '',
    image: process.env.BOOKIT_BUILD_IMAGE ?? '',
    builtAt: process.env.BOOKIT_BUILD_BUILT_AT ?? '',
  };
}
