import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { evalNow } from './support';

/** Both already-running demo clinics share this writable, mounted virtual clock. */
export function advanceReminderClock(now: Date): void {
  const file =
    process.env.EVAL_CLOCK_FILE ??
    (process.env.BOOKIT_CLOCK_DIR ? path.join(process.env.BOOKIT_CLOCK_DIR, 'clock.json') : undefined);
  if (!file) throw new Error('Set EVAL_CLOCK_FILE to the shared demo clock file');
  const clock = JSON.parse(readFileSync(file, 'utf8')) as { now: string };
  expect(now.getTime(), 'the shared demo clock only advances').toBeGreaterThanOrEqual(Date.parse(clock.now));
  const temporary = `${file}.reminder-eval.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...clock, now: now.toISOString() })}\n`);
  renameSync(temporary, file);
}

/** The next two UK clock-change Sundays, ordered so the demo clock never moves backwards. */
export function reminderClockChanges(): string[] {
  const start = evalNow();
  const dates: string[] = [];
  for (let year = start.getUTCFullYear(); dates.length < 2; year++) {
    for (const month of [2, 9]) {
      const last = new Date(Date.UTC(year, month + 1, 0));
      last.setUTCDate(last.getUTCDate() - last.getUTCDay());
      if (last.getTime() > start.getTime() + 2 * 86_400_000) dates.push(last.toISOString().slice(0, 10));
      if (dates.length === 2) break;
    }
  }
  return dates;
}

export interface ReminderMessage {
  ID: string;
  Subject: string;
  Text: string;
}

export async function reminderMessages(
  mailUrl: string,
  address: string,
  bookingId: string,
): Promise<ReminderMessage[]> {
  const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  expect(response.ok, 'the local reminder inbox answers').toBe(true);
  const { messages } = (await response.json()) as { messages: { ID: string; Subject: string }[] };
  const reminders: ReminderMessage[] = [];
  for (const message of messages.filter((message) => message.Subject.startsWith('Reminder:'))) {
    const detail = await fetch(`${mailUrl}/api/v1/message/${message.ID}`);
    expect(detail.ok, 'the local reminder email opens').toBe(true);
    const { Text } = (await detail.json()) as { Text: string };
    if (Text.includes(`/bookings/${bookingId}/`)) reminders.push({ ...message, Text: Text.replace(/\r\n/g, '\n') });
  }
  return reminders;
}

/** Observe real worker polls, rather than triggering delivery or merely checking twice immediately. */
export async function observeReminderPolls(check: () => Promise<void>, milliseconds = 65_000): Promise<void> {
  const end = performance.now() + milliseconds;
  do {
    await check();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  } while (performance.now() < end);
  await check();
}
