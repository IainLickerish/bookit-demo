import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { testClockAllowedByBuild } from './build-flags';

export interface Clock {
  now(): Date;
}

export class ClockConfigurationError extends Error {
  override readonly name = 'ClockConfigurationError';
}

export const TEST_CLOCK_REFUSED_MESSAGE =
  'BOOKIT_TEST_CLOCK is set, but this build was made without BOOKIT_ALLOW_TEST_CLOCK=true. Refusing to start.';

export const systemClock: Clock = {
  now: () => new Date(),
};

// The shared virtual clock file (SupportAgents plan 13.10) is JSON with at
// least `now`, an ISO 8601 UTC instant ending in `Z`. Other fields, such as
// `advanced_total`, are ignored. The writer replaces the file atomically
// (write a temporary file, then rename it over this one), and time never moves
// backwards. Every call reads the file, so a clock advance takes effect on the
// next call without a restart.
const clockFileSchema = z.object({
  now: z.iso.datetime(),
});

export function createFileClock(path: string): Clock {
  let lastMs = Number.NEGATIVE_INFINITY;
  return {
    now() {
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
        throw new ClockConfigurationError(`Cannot read the virtual clock file ${path} (${code}).`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ClockConfigurationError(`The virtual clock file ${path} is not valid JSON.`);
      }
      const result = clockFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new ClockConfigurationError(
          `The virtual clock file ${path} must hold {"now": "<ISO 8601 UTC instant>"}.`,
        );
      }
      const ms = Date.parse(result.data.now);
      if (ms < lastMs) {
        throw new ClockConfigurationError(
          `The virtual clock moved backwards from ${new Date(lastMs).toISOString()} to ${result.data.now}.`,
        );
      }
      lastMs = ms;
      return new Date(ms);
    },
  };
}

export function resolveClock(
  env: Readonly<Record<string, string | undefined>> = process.env,
  allowTestClock: boolean = testClockAllowedByBuild(),
): Clock {
  const path = env.BOOKIT_TEST_CLOCK;
  if (path === undefined || path === '') {
    return systemClock;
  }
  if (!allowTestClock) {
    throw new ClockConfigurationError(TEST_CLOCK_REFUSED_MESSAGE);
  }
  return createFileClock(path);
}

const CLOCK_KEY = Symbol.for('bookit.clock');

// Next.js may bundle this module more than once per process, so the resolved
// clock lives on globalThis rather than in a module variable.
const FIXTURE_KEY = Symbol.for('bookit.reminder-eval-clock');

/** Only an explicitly test-clock build with a configured file can use the eval fixture. */
export function reminderEvalClockEnabled(): boolean {
  return testClockAllowedByBuild() && process.env.BOOKIT_ENV === 'local' && Boolean(process.env.BOOKIT_TEST_CLOCK);
}

/** Ephemeral fixture time. Reset returns to the untouched file, not a backwards file rewrite. */
export function setReminderEvalClock(instant: Date | null): void {
  if (!reminderEvalClockEnabled()) throw new ClockConfigurationError('The reminder clock fixture is disabled.');
  if (instant !== null && (!Number.isFinite(instant.getTime()) || instant < getClock().now())) {
    throw new ClockConfigurationError('The reminder clock fixture must advance time.');
  }
  const holder = globalThis as { [FIXTURE_KEY]?: Date };
  if (instant === null) delete holder[FIXTURE_KEY];
  else holder[FIXTURE_KEY] = instant;
}

export function getClock(): Clock {
  const holder = globalThis as { [CLOCK_KEY]?: Clock; [FIXTURE_KEY]?: Date };
  if (!holder[CLOCK_KEY]) {
    const base = resolveClock();
    holder[CLOCK_KEY] = {
      now() {
        // Always validate the real file, including its existing monotonicity guard.
        const instant = base.now();
        const fixture = reminderEvalClockEnabled() ? holder[FIXTURE_KEY] : undefined;
        return fixture ? new Date(Math.max(instant.getTime(), fixture.getTime())) : instant;
      },
    };
  }
  return holder[CLOCK_KEY];
}
