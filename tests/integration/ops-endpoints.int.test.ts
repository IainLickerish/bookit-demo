import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildServer,
  launchServer,
  ROOT,
  startOutcome,
  TEST_COMMIT,
  writeClockFile,
  type RunningServer,
} from '../helpers/built-server';
import { startSentryReceiver, type SentryReceiver } from '../helpers/sentry-receiver';

// A test-clock build, as the M0 e2e Compose profile uses, run as Acme
// staging. Its start time and log times follow the virtual clock.
const DIST = '.next-ops';
const VIRTUAL_START = '2026-10-20T07:00:00.000Z';
const IMAGE = `ghcr.io/example-owner/bookit-demo:${TEST_COMMIT}`;
const BUILT_AT = '2026-10-23T09:00:00.000Z';
const EVIDENCE_DIR = path.join(ROOT, 'test-results/m0-24c');

let receiver: SentryReceiver;
let server: RunningServer;
let logDir: string;

function recordEvidence(name: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(data)}`);
}

function logLines(): Record<string, unknown>[] {
  return server
    .output()
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function get(route: string): Promise<Response> {
  return fetch(`${server.url}${route}`, { signal: AbortSignal.timeout(10_000) });
}

async function waitFor<T>(probe: () => T | undefined, what: string): Promise<T> {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const found = probe();
    if (found !== undefined) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

beforeAll(async () => {
  const build = buildServer(DIST, {
    allowTestClock: true,
    args: { GIT_COMMIT: TEST_COMMIT, BUILD_ID: 'ci-run-4242', BOOKIT_IMAGE: IMAGE, BUILT_AT },
  });
  if (build.status !== 0) {
    console.log(build.output);
  }
  expect(build.status).toBe(0);
  receiver = await startSentryReceiver();
  logDir = mkdtempSync(path.join(tmpdir(), 'bookit-log-volume-'));
  server = await launchServer(DIST, {
    BOOKIT_ENV: 'staging',
    BOOKIT_PRODUCT: 'ACME',
    BOOKIT_TENANT: 'acme',
    BOOKIT_DEPLOYMENT_ID: 'dep-0001',
    BOOKIT_TEST_CLOCK: writeClockFile(VIRTUAL_START),
    BOOKIT_SENTRY_DSN: receiver.dsn,
    BOOKIT_LOG_DIR: logDir,
    // A running container cannot change what the build says it is.
    GIT_COMMIT: 'f'.repeat(40),
    BOOKIT_BUILD_GIT_COMMIT: 'f'.repeat(40),
  });
  if (!server.served) {
    console.log(server.output());
  }
  expect(server.served).toBe(true);
}, 600_000);

afterAll(async () => {
  await server?.stop();
  await receiver?.stop();
});

describe('GET /api/version (REQ-18.1-05, REQ-15.4-05, plan 12.6, F-39)', () => {
  it('returns the build and container identity with Cache-Control: no-store', async () => {
    const response = await get('/api/version');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toStrictEqual({
      service: 'bookit',
      product: 'ACME',
      tenant: 'acme',
      environment: 'staging',
      commit: TEST_COMMIT,
      buildId: 'ci-run-4242',
      image: IMAGE,
      builtAt: BUILT_AT,
      deploymentId: 'dep-0001',
      startedAt: VIRTUAL_START,
    });
    recordEvidence('version-endpoint', {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      payload,
    });
  });

  it('has no side effects: repeated calls return the same body and send nothing to error reporting', async () => {
    const before = receiver.envelopes.length;
    const bodies = await Promise.all([1, 2, 3].map(async () => (await get('/api/version')).text()));
    expect(new Set(bodies).size).toBe(1);
    expect(receiver.envelopes.length).toBe(before);
  });
});

describe('GET /api/health (REQ-18.1-01 operational endpoints)', () => {
  it('answers ok with Cache-Control: no-store', async () => {
    const response = await get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', service: 'bookit' });
  });
});

describe('error reporting to a local Sentry receiver (REQ-18.1-04, REQ-15.4-05; never a real Sentry)', () => {
  it('reports an injected error with product, environment, release and request ID, and no personal data', async () => {
    const response = await fetch(`${server.url}/api/debug/error?email=patient1@patients.example.test`, {
      headers: { cookie: 'bookit_session=not-a-real-token' },
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status).toBe(500);
    const event = await waitFor(
      () => receiver.events().find((e) => JSON.stringify(e.exception ?? {}).includes('InjectedTestError')),
      'the injected error event',
    );
    expect(event).toMatchObject({
      release: TEST_COMMIT,
      environment: 'staging',
      server_name: 'bookit-acme-staging',
      tags: expect.objectContaining({
        service: 'bookit',
        product: 'ACME',
        tenant: 'acme',
        deployment_id: 'dep-0001',
        request_id: expect.stringMatching(/^req-\d{6}$/),
      }),
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain('patients.example.test');
    expect(text).not.toContain('not-a-real-token');
    expect(event).not.toHaveProperty('user');
    expect(receiver.envelopes.every((e) => e.path.startsWith('/api/1/envelope/'))).toBe(true);
    const tags = event.tags as Record<string, unknown>;
    recordEvidence('sentry-receiver-payload', {
      receiverPath: receiver.envelopes[0]?.path.split('?')[0],
      release: event.release,
      environment: event.environment,
      tags,
      exceptionType: (event.exception as { values?: { type?: string }[] }).values?.[0]?.type,
      request: event.request,
      hasUser: 'user' in event,
    });
  });
});

describe('structured logs (REQ-18.1-01 logging, REQ-15.4-05)', () => {
  it('carry product, environment, release and the counter-based request ID, at virtual time', async () => {
    await get('/api/version');
    const request = logLines()
      .filter((l) => l.event === 'http.request' && l.route === '/api/version')
      .at(-1);
    expect(request).toMatchObject({
      service: 'bookit',
      product: 'ACME',
      tenant: 'acme',
      environment: 'staging',
      release: TEST_COMMIT,
      request_id: expect.stringMatching(/^req-\d{6}$/),
      time: VIRTUAL_START,
    });
    expect(logLines().find((l) => l.event === 'startup.ready')).toMatchObject({
      deployment_id: 'dep-0001',
      build_id: 'ci-run-4242',
      error_reporting: true,
    });
  });

  it('are also written to <BOOKIT_LOG_DIR>/acme/staging.jsonl for FakeLogSource', () => {
    const file = path.join(logDir, 'acme', 'staging.jsonl');
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.some((l) => l.event === 'startup.ready')).toBe(true);
    expect(lines.some((l) => l.event === 'http.request' && l.route === '/api/version')).toBe(true);
    expect(lines.every((l) => l.product === 'ACME' && l.environment === 'staging')).toBe(true);
    recordEvidence('log-volume-file', {
      relativePath: 'acme/staging.jsonl',
      lines: lines.length,
      events: [...new Set(lines.map((l) => l.event))],
    });
  });
});

describe('test-clock builds refuse a real Sentry DSN (security: tests never contact real Sentry)', () => {
  it('refuses to start when BOOKIT_SENTRY_DSN is not a local receiver', async () => {
    const outcome = await startOutcome(DIST, {
      BOOKIT_ENV: 'staging',
      BOOKIT_PRODUCT: 'ACME',
      BOOKIT_TENANT: 'acme',
      BOOKIT_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
    });
    recordEvidence('test-clock-build-refuses-hosted-dsn', {
      exitCode: outcome.exitCode,
      served: outcome.served,
      refusalLines: outcome.output.split('\n').filter((line) => line.includes('startup.refused')),
    });
    expect(outcome.served).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain('must point at a local receiver');
  });
});
