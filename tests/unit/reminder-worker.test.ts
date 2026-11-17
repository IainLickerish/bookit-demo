import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startReminderWorker } from '@/server/notifications/reminder-worker';

const fixture = vi.hoisted(() => ({ send: vi.fn(), error: vi.fn(), report: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/lib/logger', () => ({ getLogger: () => ({ error: fixture.error }) }));
vi.mock('@/server/notifications/reminders', () => ({ sendDueReminders: fixture.send }));
vi.mock('@/server/notifications/mailer', () => ({ getMailer: () => ({ kind: 'recording' }) }));
vi.mock('@/server/error-reporting', () => ({ reportError: fixture.report }));

const key = Symbol.for('bookit.reminder-worker');
const holder = globalThis as { [key]?: NodeJS.Timeout };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('DATABASE_URL', 'postgresql://database.example.test/bookit');
  vi.stubEnv('BOOKIT_SMTP_URL', 'smtp://mail.example.test:1025');
  vi.stubEnv('BOOKIT_TENANT', 'acme');
  vi.stubEnv('BOOKIT_ENV', 'local');
  vi.stubEnv('BOOKIT_PUBLIC_URL', 'https://clinic.example.test');
  fixture.send.mockReset().mockResolvedValue(0);
  fixture.error.mockReset();
  fixture.report.mockReset();
});
afterEach(() => {
  if (holder[key]) clearInterval(holder[key]);
  delete holder[key];
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('runs at startup and every minute without overlapping or starting a second timer', async () => {
  let finish!: () => void;
  fixture.send.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  startReminderWorker();
  startReminderWorker();
  expect(fixture.send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fixture.send).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fixture.send).toHaveBeenCalledTimes(2);
  const [deps] = fixture.send.mock.calls[1]!;
  expect((deps as { clock: { now(): Date } }).clock.now().toISOString()).toBe('2026-10-20T07:00:00.000Z');
});
it('leaves unconfigured servers alone and reports job errors without sensitive details', async () => {
  vi.stubEnv('BOOKIT_SMTP_URL', '');
  startReminderWorker();
  expect(fixture.send).not.toHaveBeenCalled();
  vi.stubEnv('BOOKIT_SMTP_URL', 'smtp://mail.example.test:1025');
  fixture.send.mockRejectedValueOnce(new Error('synthetic-private-canary'));
  startReminderWorker();
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.error).toHaveBeenCalledOnce();
  expect(fixture.report).toHaveBeenCalledOnce();
  expect((fixture.report.mock.calls[0]![0] as Error).message).toBe('Reminder check failed');
  expect(JSON.stringify(fixture.error.mock.calls)).not.toContain('synthetic-private-canary');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fixture.send).toHaveBeenCalledTimes(2);
});
