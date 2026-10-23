import type { Environment } from '@/lib/runtime-identity';

/** The error GET /api/debug/error throws, so error reporting can be checked end to end. */
export class InjectedTestError extends Error {
  override readonly name = 'InjectedTestError';
  constructor() {
    super('Injected BookIt test error');
  }
}

export function injectedErrorEnabled(testClockBuild: boolean, environment: Environment): boolean {
  return testClockBuild || environment === 'local';
}
