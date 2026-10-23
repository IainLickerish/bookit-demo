import { spawnSync } from 'node:child_process';

// `next build` requires the GIT_COMMIT build argument (src/lib/build-identity.ts).
// CI and the Dockerfile pass it; for a build from a local checkout this takes
// it from git. Any other arguments go to `next build`.
function commitFromGit(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error('GIT_COMMIT is not set and `git rev-parse HEAD` failed.');
    process.exit(1);
  }
  return result.stdout.trim();
}

const env = { ...process.env, GIT_COMMIT: process.env.GIT_COMMIT?.trim() || commitFromGit() };
const result = spawnSync('next', ['build', ...process.argv.slice(2)], { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
