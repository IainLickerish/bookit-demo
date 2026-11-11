import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startReminderWorker } from '@/server/notifications/reminder-worker';
import { sendDueReminders } from '@/server/notifications/reminder';
import { getLogger } from '@/lib/logger';

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/lib/logger', () => ({ getLogger: () => ({ error: errorLog }) }));
vi.mock('@/lib/runtime-identity', () => ({ publicBaseUrl: () => new URL('https://clinic.test') }));
vi.mock('@/server/notifications/mailer', () => ({ getMailer: () => ({ kind: 'recording' }) }));
vi.mock('@/server/notifications/reminder', () => ({ sendDueReminders: vi.fn() }));

const workerKey = Symbol.for('bookit.reminder-worker');
const holder = globalThis as { [workerKey]?: ReturnType<typeof setInterval> };

beforeEach(() => {
  vi.useFakeTimers();
  errorLog.mockReset();
  vi.mocked(sendDueReminders).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  if (holder[workerKey]) clearInterval(holder[workerKey]);
  delete holder[workerKey];
  vi.useRealTimers();
});

describe('automatic reminder checks', () => {
  it('checks on startup and every minute, and starting twice creates only one loop', async () => {
    startReminderWorker();
    startReminderWorker();
    expect(sendDueReminders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendDueReminders).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendDueReminders).toHaveBeenCalledTimes(3);
  });

  it('waits for a slow check and keeps checking after an error', async () => {
    let finish!: () => void;
    vi.mocked(sendDueReminders).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    startReminderWorker();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sendDueReminders).toHaveBeenCalledTimes(1);
    finish();
    vi.mocked(sendDueReminders).mockRejectedValueOnce(new Error('Database temporarily unavailable'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendDueReminders).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendDueReminders).toHaveBeenCalledTimes(3);
  });

  it('reports a failed check without exposing patient details and tries again next minute', async () => {
    vi.mocked(sendDueReminders).mockRejectedValueOnce(new Error('Failed for private-patient@clinic.test'));
    startReminderWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(getLogger().error).toHaveBeenCalledWith(
      { event: 'reminder.worker_failed', error_name: 'Error' },
      'Reminder check failed',
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-patient@clinic.test');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendDueReminders).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
