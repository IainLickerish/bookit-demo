import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/debug/reminders/route';

const fixture = vi.hoisted(() => ({
  build: true,
  environment: 'local',
  user: null as null | { role: string },
  send: vi.fn(),
}));
vi.mock('@/lib/build-flags', () => ({ testClockAllowedByBuild: () => fixture.build }));
vi.mock('@/lib/runtime-identity', () => ({ runtimeIdentity: () => ({ environment: fixture.environment }) }));
vi.mock('@/lib/clock', () => ({ getClock: () => ({ now: () => new Date('2026-10-20T07:00:00Z') }) }));
vi.mock('@/server/request-context', () => ({ currentUser: async () => fixture.user }));
vi.mock('@/server/notifications/reminder-worker', () => ({ reminderDependencies: () => ({}) }));
vi.mock('@/server/notifications/reminders', () => ({ sendDueReminders: fixture.send }));

const bookingId = '12345678-1234-4234-8234-123456789abc';
const now = '2026-10-21T09:00:00Z';
function request(body: unknown = { bookingId, now }, origin = 'https://clinic.example.test') {
  return new NextRequest('https://clinic.example.test/api/debug/reminders', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv('BOOKIT_TEST_CLOCK', 'tests/fixtures/clock.json');
  fixture.build = true;
  fixture.environment = 'local';
  fixture.user = { role: 'admin' };
  fixture.send.mockReset().mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());

it('is unavailable in ordinary builds, production environments or without a fixed clock', async () => {
  fixture.build = false;
  expect((await POST(request())).status).toBe(404);
  fixture.build = true;
  fixture.environment = 'production';
  expect((await POST(request())).status).toBe(404);
  fixture.environment = 'local';
  vi.stubEnv('BOOKIT_TEST_CLOCK', '');
  expect((await POST(request())).status).toBe(404);
  expect(fixture.send).not.toHaveBeenCalled();
});
it('refuses visitors, clients, foreign origins, invalid input and out-of-range test times', async () => {
  fixture.user = null;
  expect((await POST(request())).status).toBe(401);
  fixture.user = { role: 'patient' };
  expect((await POST(request())).status).toBe(403);
  fixture.user = { role: 'admin' };
  expect((await POST(request(undefined, 'https://foreign.example.test'))).status).toBe(403);
  for (const body of [
    { bookingId: 'invalid', now },
    { bookingId, now, tenant: 'beacon' },
    { bookingId, now: '2024-10-19T07:00:00Z' },
    { bookingId, now: '2028-10-20T07:00:00Z' },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect(fixture.send).not.toHaveBeenCalled();
});
it('dispatches only the selected booking with a scoped clock', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ processed: 1 });
  const [deps, id] = fixture.send.mock.calls[0]!;
  expect(id).toBe(bookingId);
  expect((deps as { clock: { now(): Date } }).clock.now().toISOString()).toBe(new Date(now).toISOString());
});

it('accepts the matching public Host through a proxy and rejects opaque origins', async () => {
  const proxied = request(undefined, 'https://public-clinic.example.test');
  proxied.headers.set('host', 'public-clinic.example.test');
  expect((await POST(proxied)).status).toBe(200);
  expect((await POST(request(undefined, 'null'))).status).toBe(403);
});
