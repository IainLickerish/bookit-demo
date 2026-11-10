import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { reportError } from '../error-reporting';
import { mailSettings } from './deliver';
import { sendDueReminders } from './reminders';

/** How often the server looks for due reminders, unless BOOKIT_REMINDER_SWEEP_SECONDS says otherwise. */
export const DEFAULT_REMINDER_SWEEP_SECONDS = 300;
/** The first sweep waits for start-up to settle. */
const FIRST_SWEEP_DELAY_MS = 30_000;

export class ReminderScheduleError extends Error {
  override readonly name = 'ReminderScheduleError';
}

/** Seconds between sweeps; 0 switches the in-server sweep off. */
export function reminderSweepSeconds(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = (env.BOOKIT_REMINDER_SWEEP_SECONDS ?? '').trim();
  if (raw === '') {
    return DEFAULT_REMINDER_SWEEP_SECONDS;
  }
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
    throw new ReminderScheduleError('BOOKIT_REMINDER_SWEEP_SECONDS must be a whole number of seconds from 0 to 3600.');
  }
  return seconds;
}

const SCHEDULER_KEY = Symbol.for('bookit.reminderScheduler');

/**
 * Starts the periodic reminder sweep in this server process. Overlapping
 * sweeps in this process are skipped, and sweeps in other processes cannot
 * send the same reminder (see sendDueReminders). Without DATABASE_URL, as in
 * servers started only to check their configuration, nothing is scheduled.
 */
export function startReminderScheduler(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const seconds = reminderSweepSeconds(env);
  const holder = globalThis as { [SCHEDULER_KEY]?: true };
  if (seconds === 0 || !env.DATABASE_URL || holder[SCHEDULER_KEY]) {
    return false;
  }
  holder[SCHEDULER_KEY] = true;
  const log = getLogger().child({ component: 'reminders' });
  let running = false;
  const sweep = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await sendDueReminders({
        db: getDatabase(),
        clock: getClock(),
        log,
        mail: mailSettings(),
        publicUrl: publicBaseUrl(env),
      });
    } catch (error) {
      log.error(
        { event: 'reminders.sweep_failed', error_name: error instanceof Error ? error.name : 'unknown' },
        'Appointment reminder sweep failed',
      );
      reportError(error, { operation: 'reminder_sweep' });
    } finally {
      running = false;
    }
  };
  setTimeout(() => void sweep(), Math.min(FIRST_SWEEP_DELAY_MS, seconds * 1000)).unref();
  setInterval(() => void sweep(), seconds * 1000).unref();
  return true;
}
