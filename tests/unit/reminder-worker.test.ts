import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reminderLoop, REMINDER_INTERVAL_MS } from '@/server/reminders/worker';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('unattended reminder loop', () => {
  it('starts without a request, waits for completion and never overlaps checks', async () => {
    let release!: () => void;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const onError = vi.fn();
    const stop = reminderLoop(check, onError);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    release();
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS * 2);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports a failed check and schedules another check until stopped', async () => {
    const error = new Error('synthetic check failure');
    const check = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = reminderLoop(check, onError);
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS);
    expect(onError).toHaveBeenCalledWith(error);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
