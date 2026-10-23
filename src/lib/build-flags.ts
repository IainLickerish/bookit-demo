// next.config.ts inlines BOOKIT_BUILD_ALLOW_TEST_CLOCK at build time from the
// BOOKIT_ALLOW_TEST_CLOCK build argument, so setting either variable when a
// built server starts has no effect. Keep the literal `process.env.X` access:
// destructuring or dynamic access defeats the inlining.
export function testClockAllowedByBuild(): boolean {
  return process.env.BOOKIT_BUILD_ALLOW_TEST_CLOCK === 'true';
}
