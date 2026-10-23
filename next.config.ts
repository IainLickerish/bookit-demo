import type { NextConfig } from 'next';

function testClockBuildFlag(value: string | undefined): 'true' | 'false' {
  if (value === undefined || value === '' || value === 'false') {
    return 'false';
  }
  if (value === 'true') {
    return 'true';
  }
  throw new Error(`BOOKIT_ALLOW_TEST_CLOCK must be "true" or "false", not "${value}".`);
}

const nextConfig: NextConfig = {
  distDir: process.env.BOOKIT_DIST_DIR ?? '.next',
  // Inlined into the build, so a built server cannot be switched to the
  // virtual clock by its runtime environment (src/lib/build-flags.ts).
  env: {
    BOOKIT_BUILD_ALLOW_TEST_CLOCK: testClockBuildFlag(process.env.BOOKIT_ALLOW_TEST_CLOCK),
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
