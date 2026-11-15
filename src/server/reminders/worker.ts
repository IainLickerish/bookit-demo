import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { getLogger } from '@/lib/logger';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { mailSettings } from '@/server/notifications/deliver';
import { tenantName } from '@/server/seed/tenant';
import { sendDueReminders } from './send';

export const REMINDER_INTERVAL_MS = 10_000;

/** A serial loop: slow checks never overlap, and stopping prevents another tick. */
export function reminderLoop(check: () => Promise<unknown>, onError: (error: unknown) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    try {
      await check();
    } catch (error) {
      onError(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, REMINDER_INTERVAL_MS);
        timer.unref();
      }
    }
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const WORKER_KEY = Symbol.for('bookit.reminder-worker');
const CHECKS_KEY = Symbol.for('bookit.reminder-checks');

/** Diagnostic counters used by the protected test-clock fixture, never a sending trigger. */
export function reminderCheckStatus(): { started: number; completed: number } {
  const holder = globalThis as { [CHECKS_KEY]?: { started: number; completed: number } };
  holder[CHECKS_KEY] ??= { started: 0, completed: 0 };
  return holder[CHECKS_KEY];
}

/** Runs in each long-lived Node server, without a public trigger or request dependency. */
export function startReminderWorker(): void {
  if (!process.env.DATABASE_URL || process.env.NEXT_PHASE === 'phase-production-build') return;
  const holder = globalThis as { [WORKER_KEY]?: () => void };
  if (holder[WORKER_KEY]) return;
  holder[WORKER_KEY] = reminderLoop(
    async () => {
      const checks = reminderCheckStatus();
      const sequence = ++checks.started;
      try {
        const clock = getClock();
        await sendDueReminders({
          db: getDatabase(),
          clock,
          log: getLogger().child({ request_id: newId(clock), operation: 'reminders' }),
          mail: mailSettings(),
          tenant: tenantName.parse(process.env.BOOKIT_TENANT),
          publicUrl: publicBaseUrl(),
        });
      } finally {
        checks.completed = sequence;
      }
    },
    (error) => {
      // Do not log raw errors, which may carry query parameters or SMTP content.
      try {
        getLogger().error(
          { event: 'reminder.worker_failed', error_name: error instanceof Error ? error.name : 'unknown' },
          'Reminder check failed; the next check will run automatically',
        );
      } catch {
        process.stderr.write('{"level":"error","event":"reminder.worker_failed"}\n');
      }
    },
  );
}
