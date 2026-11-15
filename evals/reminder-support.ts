import { expect, type Page } from '@playwright/test';
import { bookSlot, bookingRow, evalNow, londonDate, mailTo, showDay, ADMIN, signIn } from './support';

/** Choose by its displayed start instant, rather than a generated booking identifier or list position. */
export async function bookDueSession(page: Page, nowInstant = evalNow()): Promise<{ id: string; when: string }> {
  const now = nowInstant.getTime();
  for (const offset of [0, 1]) {
    await showDay(page, londonDate(offset, nowInstant));
    const offered = await page.getByTestId('slot-link').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-slot-id'),
        start: node.getAttribute('data-starts-at'),
      })),
    );
    const due = offered.find(
      (slot) => slot.start && Date.parse(slot.start) > now && Date.parse(slot.start) <= now + 86_400_000,
    );
    if (!due?.id) continue;
    const when = await bookSlot(page, due.id);
    const id = await bookingRow(page, 'upcoming-bookings', when).getAttribute('data-booking-id');
    expect(id, 'the saved booking has its reference').toBeTruthy();
    return { id: id!, when };
  }
  throw new Error('The fixed demo day must offer a free session within the next 24 hours.');
}

export async function setReminders(page: Page, choice: string): Promise<void> {
  await page.goto('/admin/settings');
  await page.getByTestId('admin-reminders').selectOption(choice);
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
  await page.reload();
  await expect(page.getByTestId('admin-reminders')).toHaveValue(choice);
}

export async function remindersFor(address: string, bookingId: string): Promise<{ text: string; subject: string }[]> {
  const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  const messages = (await mailTo(address)).filter((message) => message.Subject.startsWith('Reminder:'));
  const emails = await Promise.all(
    messages.map(async (message) => {
      const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
      expect(response.ok, 'the reminder can be opened in the demo inbox').toBe(true);
      return { text: ((await response.json()) as { Text: string }).Text, subject: message.Subject };
    }),
  );
  return emails.filter((email) => email.text.includes(`Booking reference: ${bookingId}`));
}

export async function waitForReminder(address: string, bookingId: string) {
  await expect
    .poll(async () => (await remindersFor(address, bookingId)).length, {
      timeout: 30_000,
      message: 'one reminder arrives from the unattended check',
    })
    .toBe(1);
  return (await remindersFor(address, bookingId))[0]!;
}

export interface ReminderClockSnapshot {
  now: string;
  started: number;
  completed: number;
}

export async function reminderClock(page: Page): Promise<ReminderClockSnapshot> {
  const response = await page.request.get('/api/debug/reminder-clock');
  expect(response.ok(), 'the signed-in staff test-clock fixture answers').toBe(true);
  return (await response.json()) as ReminderClockSnapshot;
}

export async function setReminderClock(page: Page, now: string | null): Promise<ReminderClockSnapshot> {
  const origin = new URL(page.url()).origin;
  let snapshot: ReminderClockSnapshot | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.post('/api/debug/reminder-clock', { data: { now }, headers: { origin } });
        if (response.status() === 409) return false;
        if (response.status() === 403 && now === null) {
          // Cleanup must still work if advancing the fixture expired the old session.
          await signIn(page, ADMIN);
          return false;
        }
        expect(response.ok(), 'the test clock changes only between background checks').toBe(true);
        snapshot = (await response.json()) as ReminderClockSnapshot;
        return true;
      },
      { timeout: 30_000, message: 'the background check finishes before the clock advances' },
    )
    .toBe(true);
  return snapshot!;
}

export async function bookOutsideReminderWindow(page: Page, now: Date) {
  for (const offset of [1, 2]) {
    await showDay(page, londonDate(offset, now));
    const offered = await page.getByTestId('slot-link').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-slot-id'),
        start: node.getAttribute('data-starts-at'),
      })),
    );
    const later = offered.find((slot) => slot.start && Date.parse(slot.start) > now.getTime() + 86_400_000);
    if (!later?.id || !later.start) continue;
    const when = await bookSlot(page, later.id);
    const id = await bookingRow(page, 'upcoming-bookings', when).getAttribute('data-booking-id');
    expect(id, 'the future booking has its reference').toBeTruthy();
    return {
      id: id!,
      when,
      startsAt: later.start,
      clinic: (await page.getByTestId('clinic-name').textContent())?.trim(),
    };
  }
  throw new Error('The demo must offer a free session outside the 24-hour reminder window.');
}
