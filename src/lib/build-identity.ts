// What a build says about itself on /api/version (plan 12.6). next.config.ts
// reads these from build arguments and inlines them, so a running server can
// never compute or change them. This module has no Next.js dependencies so
// next.config.ts can import it.

export interface BuildIdentity {
  /** The commit the image was built from; 40 hex characters outside local runs. */
  commit: string;
  /** The CI run ID, or `local`. */
  buildId: string;
  /** The image reference, `ghcr.io/<github-owner>/bookit-demo:<sha>` for CI builds. */
  image: string;
  /** When the build ran, ISO 8601 UTC. */
  builtAt: string;
}

export class BuildConfigurationError extends Error {
  override readonly name = 'BuildConfigurationError';
}

export const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;

function argument(env: Readonly<Record<string, string | undefined>>, name: string): string {
  return (env[name] ?? '').trim();
}

/**
 * The build identity from the build arguments GIT_COMMIT, BUILD_ID,
 * BOOKIT_IMAGE and BUILT_AT. GIT_COMMIT is required, so a build without it
 * fails; the start-up check later refuses anything but a full SHA outside
 * local runs. `buildTime` is used only when BUILT_AT is not given.
 */
export function buildIdentityFromArguments(
  env: Readonly<Record<string, string | undefined>>,
  buildTime: Date,
): BuildIdentity {
  const commit = argument(env, 'GIT_COMMIT');
  if (commit === '') {
    throw new BuildConfigurationError(
      'GIT_COMMIT is empty. Pass the commit SHA as a build argument (bun run build sets it from git).',
    );
  }
  if (!/^[0-9A-Za-z._-]{1,64}$/.test(commit)) {
    throw new BuildConfigurationError('GIT_COMMIT must be a commit SHA.');
  }
  const builtAt = argument(env, 'BUILT_AT') || buildTime.toISOString();
  if (Number.isNaN(Date.parse(builtAt)) || !builtAt.endsWith('Z')) {
    throw new BuildConfigurationError('BUILT_AT must be an ISO 8601 UTC instant ending in Z.');
  }
  return {
    commit,
    buildId: argument(env, 'BUILD_ID') || 'local',
    image: argument(env, 'BOOKIT_IMAGE') || `bookit-demo:${commit}`,
    builtAt,
  };
}
