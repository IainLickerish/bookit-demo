import { expect, type Page } from '@playwright/test';
import { mailTo } from './support';

/** The reminder clock for the London date and time displayed in this check's own booking. */
export function reminderTime(date: string, time: string): string {
  const candidate = new Date(`${date}T${time}:00Z`);
  const londonHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(candidate),
  );
  const offset = londonHour - Number(time.slice(0, 2));
  return new Date(candidate.getTime() - offset * 3_600_000 - 24 * 3_600_000).toISOString();
}

/** A staff-only test-build fixture: run the real dispatcher for one booking, without changing the shared clock. */
export async function dispatchAt(staff: Page, bookingId: string, now: string): Promise<number> {
  const origin = new URL(staff.url()).origin;
  const response = await staff.request.post(`${origin}/api/debug/reminders`, {
    headers: { origin },
    data: { bookingId, now },
  });
  expect(response.ok(), 'the authorised reminder clock fixture answers').toBe(true);
  return ((await response.json()) as { processed: number }).processed;
}

export async function remindersFor(address: string, bookingId: string): Promise<{ id: string; text: string }[]> {
  const base = process.env.EVAL_MAIL_URL!;
  const result: { id: string; text: string }[] = [];
  for (const message of (await mailTo(address)).filter((mail) => /^Your session reminder:/.test(mail.Subject))) {
    const body = (await (await fetch(`${base}/api/v1/message/${message.ID}`)).json()) as { Text: string };
    if (body.Text.includes(`/bookings#booking-${bookingId}`)) result.push({ id: message.ID, text: body.Text });
  }
  return result;
}

export async function setReminders(staff: Page, enabled: boolean): Promise<void> {
  await staff.getByTestId('admin-reminders-enabled').setChecked(enabled);
  await staff.getByTestId('admin-save-settings').click();
  await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();
}
