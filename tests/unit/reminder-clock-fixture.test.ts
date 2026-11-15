import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/debug/reminder-clock/route';
import { getClock, reminderEvalClockEnabled } from '@/lib/clock';
import { currentUser } from '@/server/request-context';
import { reminderCheckStatus } from '@/server/reminders/worker';

vi.mock('@/server/request-context', () => ({ currentUser: vi.fn() }));
vi.mock('@/server/reminders/worker', () => ({ reminderCheckStatus: vi.fn() }));
const admin = {
  id: 'fixture-staff',
  name: 'Fictional Staff',
  email: 'staff@clinic.test',
  role: 'admin' as const,
  phone: null,
};
const base = '2026-10-20T07:00:00.000Z';
const later = '2026-10-20T08:00:00.000Z';
let directory: string;
let file: string;
function clearFixture() {
  Reflect.deleteProperty(globalThis, Symbol.for('bookit.clock'));
  Reflect.deleteProperty(globalThis, Symbol.for('bookit.reminder-eval-clock'));
}
function post(now: unknown, origin = 'https://clinic.example.test') {
  return POST(
    new Request('https://clinic.example.test/api/debug/reminder-clock', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ now }),
    }),
  );
}
beforeEach(() => {
  clearFixture();
  directory = mkdtempSync(path.join(tmpdir(), 'bookit-reminder-fixture-'));
  file = path.join(directory, 'clock.json');
  writeFileSync(file, JSON.stringify({ now: base }));
  vi.stubEnv('BOOKIT_TEST_CLOCK', file);
  vi.stubEnv('BOOKIT_BUILD_ALLOW_TEST_CLOCK', 'true');
  vi.stubEnv('BOOKIT_ENV', 'local');
  vi.stubEnv('BOOKIT_PUBLIC_URL', 'https://clinic.example.test');
  vi.mocked(currentUser).mockResolvedValue(admin);
  vi.mocked(reminderCheckStatus).mockReturnValue({ started: 3, completed: 3 });
});
afterEach(() => {
  clearFixture();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(directory, { recursive: true });
});

describe('protected reminder timing fixture', () => {
  it('is absent from normal builds even if a caller supplies clock variables', async () => {
    vi.stubEnv('BOOKIT_BUILD_ALLOW_TEST_CLOCK', 'false');
    expect((await GET()).status).toBe(404);
    expect((await post(later)).status).toBe(404);
    expect(currentUser).not.toHaveBeenCalled();
  });
  it.each(['staging', 'production'])('is absent in %s even in a test-clock build', async (environment) => {
    vi.stubEnv('BOOKIT_ENV', environment);
    expect(reminderEvalClockEnabled()).toBe(false);
    expect((await post(later)).status).toBe(404);
  });
  it('requires a configured file and never enables a production system clock override', async () => {
    vi.stubEnv('BOOKIT_TEST_CLOCK', '');
    expect((await GET()).status).toBe(404);
    expect((await post(later)).status).toBe(404);
  });
  it.each([null, { ...admin, role: 'patient' as const }])(
    'refuses a visitor or patient before changing time',
    async (user) => {
      vi.mocked(currentUser).mockResolvedValue(user);
      expect((await GET()).status).toBe(403);
      expect((await post(later)).status).toBe(403);
      expect(getClock().now().toISOString()).toBe(base);
    },
  );
  it('refuses cross-origin changes, malformed times and backwards advances', async () => {
    expect((await post(later, 'https://other.example.test')).status).toBe(403);
    for (const invalid of ['not-a-time', 12, '2026-10-20T06:59:59.000Z']) {
      expect((await post(invalid)).status).toBe(400);
    }
    expect(getClock().now().toISOString()).toBe(base);
  });
  it('advances the shared application clock and restores the untouched fixed file', async () => {
    const clock = getClock();
    const response = await post(later);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ now: later, started: 3, completed: 3 });
    expect(clock.now().toISOString()).toBe(later);
    expect(await (await GET()).json()).toEqual({ now: later, started: 3, completed: 3 });
    expect((await post(null)).status).toBe(200);
    expect(clock.now().toISOString()).toBe(base);
  });
  it('never advances during a running check or starts a check itself', async () => {
    vi.mocked(reminderCheckStatus).mockReturnValue({ started: 4, completed: 3 });
    expect((await post(later)).status).toBe(409);
    expect(getClock().now().toISOString()).toBe(base);
  });
  it('continues enforcing the real clock file’s monotonicity and readability during an override', async () => {
    expect((await post(later)).status).toBe(200);
    writeFileSync(file, JSON.stringify({ now: '2026-10-20T06:00:00.000Z' }));
    expect(() => getClock().now()).toThrow('moved backwards');
    rmSync(file);
    expect(() => getClock().now()).toThrow('Cannot read');
  });
});
