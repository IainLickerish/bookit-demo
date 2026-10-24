import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const NEXT = path.join(ROOT, 'node_modules/.bin/next');

/** A full commit SHA for test builds; not a real commit. */
export const TEST_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * The only variables a test server inherits. Nothing else from the test
 * process leaks in, so no test server can be pointed at a real Sentry, SMTP
 * server or database by the developer's environment.
 */
export function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

export interface BuildOptions {
  allowTestClock: boolean;
  /** Build arguments such as GIT_COMMIT, BUILD_ID, BOOKIT_IMAGE and BUILT_AT. */
  args: Record<string, string>;
}

export interface BuildResult {
  status: number | null;
  output: string;
}

export function buildServer(distDir: string, options: BuildOptions): BuildResult {
  const result = spawnSync(NEXT, ['build'], {
    cwd: ROOT,
    env: {
      ...baseEnv(),
      BOOKIT_DIST_DIR: distDir,
      BOOKIT_ALLOW_TEST_CLOCK: options.allowTestClock ? 'true' : 'false',
      ...options.args,
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
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

export interface RunningServer {
  url: string;
  /** True once the server answered a request; false if it exited first. */
  served: boolean;
  exitCode: number | null;
  output(): string;
  stop(): Promise<void>;
}

/** Starts a built server and waits until it serves a request or exits. */
export async function launchServer(distDir: string, env: Record<string, string>): Promise<RunningServer> {
  const port = await freePort();
  const child = spawn(NEXT, ['start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...baseEnv(), BOOKIT_DIST_DIR: distDir, ...env },
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  let exitCode: number | null = null;
  let running = true;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', (code) => {
      exitCode = code;
      running = false;
      resolve();
    }),
  );
  const url = `http://127.0.0.1:${port}`;
  let served = false;
  const deadline = performance.now() + 30_000;
  while (running && performance.now() < deadline) {
    try {
      await fetch(`${url}/favicon.ico`, { signal: AbortSignal.timeout(2_000) });
      served = true;
      break;
    } catch {
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 250))]);
    }
  }
  return {
    url,
    served,
    get exitCode() {
      return exitCode;
    },
    output: () => output,
    async stop() {
      if (running) {
        child.kill('SIGTERM');
        await exited;
      }
    },
  };
}

export interface StartOutcome {
  exitCode: number | null;
  served: boolean;
  output: string;
}

/** Starts a built server, records whether it served or exited, and stops it. */
export async function startOutcome(distDir: string, env: Record<string, string>): Promise<StartOutcome> {
  const server = await launchServer(distDir, env);
  const exitCode = server.exitCode;
  await server.stop();
  return { exitCode, served: server.served, output: server.output() };
}

export function writeClockFile(now: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'bookit-clock-')), 'clock.json');
  writeFileSync(file, JSON.stringify({ now }));
  return file;
}
