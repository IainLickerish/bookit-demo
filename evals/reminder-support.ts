import { expect, type Page } from '@playwright/test';
import { bookSlot, bookingRow, evalNow, londonDate, mailTo, showDay } from './support';

/** Choose by its displayed start instant, rather than a generated booking identifier or list position. */
export async function bookDueSession(page: Page): Promise<{ id: string; when: string }> {
  const now = evalNow().getTime();
  for (const offset of [0, 1]) {
    await showDay(page, londonDate(offset));
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
