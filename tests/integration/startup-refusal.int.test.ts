import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildServer,
  launchServer,
  ROOT,
  startOutcome,
  TEST_COMMIT,
  writeClockFile,
  type StartOutcome,
} from '../helpers/built-server';

const PRODUCTION_DIST = '.next';
const TEST_CLOCK_DIST = '.next-e2e';
const LOCAL = { BOOKIT_TENANT: 'test', BOOKIT_ENV: 'local' };
const STAGING = {
  BOOKIT_ENV: 'staging',
  BOOKIT_PRODUCT: 'ACME',
  BOOKIT_TENANT: 'acme',
  BOOKIT_PUBLIC_URL: 'https://acme-staging.example.test',
};

function record(bead: 'm0-24a' | 'm0-24c', name: string, outcome: StartOutcome): void {
  const dir = path.join(ROOT, 'test-results', bead);
  mkdirSync(dir, { recursive: true });
  const summary = {
    exitCode: outcome.exitCode,
    served: outcome.served,
    refusalLines: outcome.output.split('\n').filter((line) => line.includes('startup.refused')),
  };
  writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(summary)}`);
}

beforeAll(() => {
  const production = buildServer(PRODUCTION_DIST, { allowTestClock: false, args: { GIT_COMMIT: TEST_COMMIT } });
  // The test-clock build gets a commit that is not a full SHA, as a build
  // from a work-in-progress tree might.
  const testClock = buildServer(TEST_CLOCK_DIST, { allowTestClock: true, args: { GIT_COMMIT: 'e2e-local' } });
  for (const result of [production, testClock]) {
    if (result.status !== 0) {
      console.log(result.output);
    }
    expect(result.status).toBe(0);
  }
}, 600_000);

describe('start-up refusal of BOOKIT_TEST_CLOCK (security, plan 12.8)', () => {
  it('a production-mode build refuses to start with BOOKIT_TEST_CLOCK set, even if the runtime tries to allow it', async () => {
    const outcome = await startOutcome(PRODUCTION_DIST, {
      ...LOCAL,
      BOOKIT_TEST_CLOCK: writeClockFile('2026-10-20T07:00:00Z'),
      BOOKIT_ALLOW_TEST_CLOCK: 'true',
      BOOKIT_BUILD_ALLOW_TEST_CLOCK: 'true',
    });
    record('m0-24a', 'production-build-refuses-test-clock', outcome);
    expect(outcome.served).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain('"event":"startup.refused"');
    expect(outcome.output).toContain('this build was made without BOOKIT_ALLOW_TEST_CLOCK=true');
  });

  it('a production-mode build starts normally without BOOKIT_TEST_CLOCK', async () => {
    const outcome = await startOutcome(PRODUCTION_DIST, LOCAL);
    record('m0-24a', 'production-build-starts', outcome);
    expect(outcome.served).toBe(true);
    expect(outcome.output).not.toContain('startup.refused');
  });

  it('a test-clock build starts with a readable clock file and refuses an unreadable one', async () => {
    const good = await startOutcome(TEST_CLOCK_DIST, {
      ...LOCAL,
      BOOKIT_TEST_CLOCK: writeClockFile('2026-10-20T07:00:00Z'),
    });
    record('m0-24a', 'test-clock-build-starts', good);
    expect(good.served).toBe(true);
    const missing = await startOutcome(TEST_CLOCK_DIST, {
      ...LOCAL,
      BOOKIT_TEST_CLOCK: '/nonexistent/bookit-clock.json',
    });
    record('m0-24a', 'test-clock-build-refuses-missing-clock', missing);
    expect(missing.served).toBe(false);
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain('Cannot read the virtual clock file');
  });
});

describe('start-up refusal on build and container identity (REQ-18.1-05, plan 12.6, security)', () => {
  it('next build fails when GIT_COMMIT is empty', () => {
    const result = buildServer('.next-no-commit', { allowTestClock: false, args: { GIT_COMMIT: '' } });
    const summary = { exitCode: result.status, mentionsGitCommit: result.output.includes('GIT_COMMIT is empty') };
    mkdirSync(path.join(ROOT, 'test-results/m0-24c'), { recursive: true });
    writeFileSync(
      path.join(ROOT, 'test-results/m0-24c/build-refuses-empty-git-commit.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.log(`evidence build-refuses-empty-git-commit: ${JSON.stringify(summary)}`);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('GIT_COMMIT is empty');
  });

  it('a staging container built with a full SHA and given product and tenant starts, without the injected error route', async () => {
    const server = await launchServer(PRODUCTION_DIST, STAGING);
    try {
      expect(server.served).toBe(true);
      const injected = await fetch(`${server.url}/api/debug/error`, { signal: AbortSignal.timeout(5_000) });
      expect(injected.status).toBe(404);
    } finally {
      await server.stop();
    }
    expect(server.output()).not.toContain('startup.refused');
  });

  it('a staging container without BOOKIT_PRODUCT refuses to start', async () => {
    const outcome = await startOutcome(PRODUCTION_DIST, { BOOKIT_ENV: 'staging', BOOKIT_TENANT: 'acme' });
    record('m0-24c', 'staging-refuses-missing-product', outcome);
    expect(outcome.served).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain('BOOKIT_PRODUCT must be set when BOOKIT_ENV is staging.');
  });

  it('a staging container whose build has no full GIT_COMMIT refuses to start, and the same build runs locally', async () => {
    const outcome = await startOutcome(TEST_CLOCK_DIST, STAGING);
    record('m0-24c', 'staging-refuses-build-without-full-commit', outcome);
    expect(outcome.served).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain('GIT_COMMIT must be a 40-character commit SHA when BOOKIT_ENV is staging');
    const local = await startOutcome(TEST_CLOCK_DIST, LOCAL);
    expect(local.served).toBe(true);
  });
});
