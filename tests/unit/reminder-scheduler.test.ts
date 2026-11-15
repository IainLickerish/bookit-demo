import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disabledMailer } from '@/server/notifications/mailer';
import { startReminderScheduler } from '@/server/notifications/reminder-scheduler';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

const mocks = vi.hoisted(() => ({
  send: vi.fn<() => Promise<void>>(),
  mail: vi.fn(),
  logger: vi.fn(),
  report: vi.fn(),
}));
vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/lib/logger', async (original) => ({ ...(await original<object>()), getLogger: mocks.logger }));
vi.mock('@/server/notifications/deliver', () => ({ mailSettings: mocks.mail }));
vi.mock('@/server/notifications/reminders', () => ({ sendDueReminders: mocks.send }));
vi.mock('@/server/error-reporting', () => ({ reportError: mocks.report }));

const key = Symbol.for('bookit.reminder-scheduler');
const holder = globalThis as { [key]?: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('DATABASE_URL', 'postgresql://unused.test/bookit');
  vi.stubEnv('BOOKIT_PUBLIC_URL', 'https://clinic.example.test');
  vi.stubEnv('BOOKIT_TENANT', 'acme');
  mocks.send.mockResolvedValue(undefined);
  mocks.mail.mockReturnValue(testMail());
  mocks.logger.mockReturnValue(captureLogs(manualClock('2026-10-20T07:00:00Z')).log);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  delete holder[key];
});

describe('automatic reminder checks', () => {
  it('runs without a visit, repeats, and starts only once per process', async () => {
    startReminderScheduler();
    startReminderScheduler();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'acme', publicUrl: new URL('https://clinic.example.test') }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('does not overlap slow passes and continues after a failed check', async () => {
    let finish!: () => void;
    mocks.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    startReminderScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    finish();
    mocks.send.mockRejectedValueOnce(new Error('test failure'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it('does not start without a database or an enabled mail transport', () => {
    vi.stubEnv('DATABASE_URL', '');
    startReminderScheduler();
    expect(mocks.send).not.toHaveBeenCalled();
    vi.stubEnv('DATABASE_URL', 'postgresql://unused.test/bookit');
    mocks.mail.mockReturnValue(testMail(disabledMailer));
    startReminderScheduler();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
