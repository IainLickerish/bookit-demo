import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testClockAllowedByBuild } from '@/lib/build-flags';
import { ClockConfigurationError, resolveClock, systemClock, TEST_CLOCK_REFUSED_MESSAGE } from '@/lib/clock';
import { checkStartupConfiguration } from '@/server/startup';

function clockFile(contents: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bookit-clock-'));
  const file = path.join(dir, 'clock.json');
  writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
}

function rewrite(file: string, contents: unknown): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(contents));
  renameSync(temporary, file);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shared virtual clock in test-clock builds (REQ-18.1-01, plan 12.8 and 13.10)', () => {
  it('uses the system clock when BOOKIT_TEST_CLOCK is not set', () => {
    expect(resolveClock({}, true)).toBe(systemClock);
    expect(resolveClock({ BOOKIT_TEST_CLOCK: '' }, false)).toBe(systemClock);
  });

  it('reads the virtual time from the clock file and follows each advance without a restart', () => {
    const file = clockFile({ now: '2026-10-20T11:00:00Z', advanced_total: 'PT0S' });
    const clock = resolveClock({ BOOKIT_TEST_CLOCK: file }, true);
    expect(clock.now().toISOString()).toBe('2026-10-20T11:00:00.000Z');
    rewrite(file, { now: '2026-10-20T14:30:00Z', advanced_total: 'PT3H30M' });
    expect(clock.now().toISOString()).toBe('2026-10-20T14:30:00.000Z');
  });

  it('refuses a clock that moves backwards', () => {
    const file = clockFile({ now: '2026-10-20T11:00:00Z' });
    const clock = resolveClock({ BOOKIT_TEST_CLOCK: file }, true);
    clock.now();
    rewrite(file, { now: '2026-10-20T10:59:59Z' });
    expect(() => clock.now()).toThrow(/moved backwards/);
  });

  it('refuses a missing, malformed or non-UTC clock file instead of falling back to real time', () => {
    const missing = path.join(mkdtempSync(path.join(tmpdir(), 'bookit-clock-')), 'absent.json');
    expect(() => resolveClock({ BOOKIT_TEST_CLOCK: missing }, true).now()).toThrow(ClockConfigurationError);
    expect(() => resolveClock({ BOOKIT_TEST_CLOCK: clockFile('{not json') }, true).now()).toThrow(/not valid JSON/);
    expect(() =>
      resolveClock({ BOOKIT_TEST_CLOCK: clockFile({ now: '2026-10-20T12:00:00+01:00' }) }, true).now(),
    ).toThrow(/ISO 8601 UTC/);
    expect(() => resolveClock({ BOOKIT_TEST_CLOCK: clockFile({ time: '2026-10-20T11:00:00Z' }) }, true).now()).toThrow(
      /ISO 8601 UTC/,
    );
  });
});

describe('production-mode builds refuse BOOKIT_TEST_CLOCK (security, plan 12.8)', () => {
  it('refuses to resolve a clock when the build does not allow a test clock', () => {
    const file = clockFile({ now: '2026-10-20T11:00:00Z' });
    expect(() => resolveClock({ BOOKIT_TEST_CLOCK: file }, false)).toThrow(TEST_CLOCK_REFUSED_MESSAGE);
  });

  it('fails the start-up check of a production-mode build that has BOOKIT_TEST_CLOCK set', () => {
    const file = clockFile({ now: '2026-10-20T11:00:00Z' });
    expect(() => checkStartupConfiguration({ BOOKIT_TEST_CLOCK: file }, false)).toThrow(TEST_CLOCK_REFUSED_MESSAGE);
    expect(() => checkStartupConfiguration({ BOOKIT_ENV: 'local' }, false)).not.toThrow();
  });

  it('fails the start-up check of a test-clock build whose clock file is unreadable', () => {
    expect(() => checkStartupConfiguration({ BOOKIT_TEST_CLOCK: '/nonexistent/clock.json' }, true)).toThrow(
      ClockConfigurationError,
    );
    const file = clockFile({ now: '2026-10-20T11:00:00Z' });
    expect(() => checkStartupConfiguration({ BOOKIT_TEST_CLOCK: file, BOOKIT_ENV: 'local' }, true)).not.toThrow();
  });

  it('takes the build flag only from the value Next.js inlines at build time', () => {
    vi.stubEnv('BOOKIT_BUILD_ALLOW_TEST_CLOCK', 'false');
    vi.stubEnv('BOOKIT_ALLOW_TEST_CLOCK', 'true');
    expect(testClockAllowedByBuild()).toBe(false);
    vi.stubEnv('BOOKIT_BUILD_ALLOW_TEST_CLOCK', 'true');
    expect(testClockAllowedByBuild()).toBe(true);
  });
});
