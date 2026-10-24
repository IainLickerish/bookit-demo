import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NEXT = path.join(ROOT, 'node_modules/.bin/next');
const EVIDENCE_DIR = path.join(ROOT, 'test-results/m0-24a');

const PRODUCTION_DIST = '.next';
const TEST_CLOCK_DIST = '.next-e2e';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

function build(distDir: string, allowTestClock: boolean): void {
  const result = spawnSync(NEXT, ['build'], {
    cwd: ROOT,
    env: {
      ...baseEnv(),
      BOOKIT_DIST_DIR: distDir,
      BOOKIT_ALLOW_TEST_CLOCK: allowTestClock ? 'true' : 'false',
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (result.status !== 0) {
    console.log(result.stdout, result.stderr);
  }
  expect(result.status).toBe(0);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

interface StartOutcome {
  exitCode: number | null;
  served: boolean;
  output: string;
}

/** Starts a built server and reports whether it served a request or exited. */
async function start(distDir: string, env: Record<string, string>): Promise<StartOutcome> {
  const port = await freePort();
  const child = spawn(NEXT, ['start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...baseEnv(), BOOKIT_DIST_DIR: distDir, BOOKIT_TENANT: 'test', BOOKIT_ENV: 'local', ...env },
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  let served = false;
  let exitCode: number | null = null;
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const finished = await Promise.race([exited, new Promise<'running'>((r) => setTimeout(() => r('running'), 250))]);
    if (finished !== 'running') {
      exitCode = finished;
      break;
    }
    try {
      await fetch(`http://127.0.0.1:${port}/favicon.ico`, { signal: AbortSignal.timeout(2_000) });
      served = true;
      break;
    } catch {
      // Not listening yet.
    }
  }
  if (exitCode === null) {
    child.kill('SIGTERM');
    await exited;
  }
  return { exitCode, served, output };
}

function clockFile(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'bookit-clock-')), 'clock.json');
  writeFileSync(file, JSON.stringify({ now: '2026-10-20T07:00:00Z' }));
  return file;
}

function record(name: string, outcome: StartOutcome): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const summary = {
    exitCode: outcome.exitCode,
    served: outcome.served,
    refusalLines: outcome.output.split('\n').filter((line) => line.includes('startup.refused')),
  };
  writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(summary)}`);
}

describe('start-up refusal of BOOKIT_TEST_CLOCK (security, plan 12.8)', () => {
  beforeAll(() => {
    build(PRODUCTION_DIST, false);
    build(TEST_CLOCK_DIST, true);
  }, 600_000);

  it('a production-mode build refuses to start with BOOKIT_TEST_CLOCK set, even if the runtime tries to allow it', async () => {
    const outcome = await start(PRODUCTION_DIST, {
      BOOKIT_TEST_CLOCK: clockFile(),
      BOOKIT_ALLOW_TEST_CLOCK: 'true',
      BOOKIT_BUILD_ALLOW_TEST_CLOCK: 'true',
    });
    record('production-build-refuses-test-clock', outcome);
    expect(outcome.served).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain('"event":"startup.refused"');
    expect(outcome.output).toContain('this build was made without BOOKIT_ALLOW_TEST_CLOCK=true');
  });

  it('a production-mode build starts normally without BOOKIT_TEST_CLOCK', async () => {
    const outcome = await start(PRODUCTION_DIST, {});
    record('production-build-starts', outcome);
    expect(outcome.served).toBe(true);
    expect(outcome.output).not.toContain('startup.refused');
  });

  it('a test-clock build starts with a readable clock file and refuses an unreadable one', async () => {
    const good = await start(TEST_CLOCK_DIST, { BOOKIT_TEST_CLOCK: clockFile() });
    record('test-clock-build-starts', good);
    expect(good.served).toBe(true);
    const missing = await start(TEST_CLOCK_DIST, { BOOKIT_TEST_CLOCK: '/nonexistent/bookit-clock.json' });
    record('test-clock-build-refuses-missing-clock', missing);
    expect(missing.served).toBe(false);
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain('Cannot read the virtual clock file');
  });
});
