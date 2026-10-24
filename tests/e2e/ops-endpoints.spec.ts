import { expect, test } from '@playwright/test';
import { E2E_COMMIT, serverLogLines } from './support';

// Runs after booking.spec.ts against the same local test-clock server.
test.describe('BookIt operational endpoints (REQ-18.1-05, REQ-18.1-01)', () => {
  test('GET /api/version reports the build and the local container, uncached', async ({ request }) => {
    const response = await request.get('/api/version');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      service: 'bookit',
      product: 'unset',
      tenant: 'test',
      environment: 'local',
      commit: E2E_COMMIT,
      buildId: 'local',
      deploymentId: 'unset',
    });
    // The server started at virtual time, before any test advanced the clock.
    expect(payload.startedAt).toBe('2026-10-20T07:00:00.000Z');
  });

  test('GET /api/health answers without a session', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'bookit' });
  });

  test('the injected error route answers 500 on a local server that has no error reporting configured', async ({
    request,
  }) => {
    const response = await request.get('/api/debug/error');
    expect(response.status()).toBe(500);
    const ready = serverLogLines().find((line) => line.event === 'startup.ready');
    expect(ready).toMatchObject({ error_reporting: false, release: E2E_COMMIT });
  });
});
