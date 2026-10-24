import type { BuildIdentity } from '@/lib/build-identity';
import type { Clock } from '@/lib/clock';
import type { RuntimeIdentity } from '@/lib/runtime-identity';

/** The body of GET /api/version (plan 12.6, F-39). */
export interface VersionPayload {
  service: 'bookit';
  product: string;
  tenant: string;
  environment: string;
  commit: string;
  buildId: string;
  image: string;
  builtAt: string;
  deploymentId: string;
  startedAt: string;
}

export function versionPayload(build: BuildIdentity, runtime: RuntimeIdentity, startedAt: Date): VersionPayload {
  return {
    service: 'bookit',
    product: runtime.product,
    tenant: runtime.tenant,
    environment: runtime.environment,
    commit: build.commit,
    buildId: build.buildId,
    image: build.image,
    builtAt: build.builtAt,
    deploymentId: runtime.deploymentId,
    startedAt: startedAt.toISOString(),
  };
}

const STARTED_AT_KEY = Symbol.for('bookit.startedAt');

/** Records when this server started, from the application clock. */
export function recordStartedAt(instant: Date): void {
  (globalThis as { [STARTED_AT_KEY]?: Date })[STARTED_AT_KEY] = instant;
}

/** When this server started; `next dev` skips start-up, so it is recorded on first use there. */
export function serverStartedAt(clock: Clock): Date {
  const holder = globalThis as { [STARTED_AT_KEY]?: Date };
  holder[STARTED_AT_KEY] ??= clock.now();
  return holder[STARTED_AT_KEY];
}
