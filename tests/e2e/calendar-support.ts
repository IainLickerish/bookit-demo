import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { ComposeTenant } from '../helpers/compose';

export function expectedCalendar(clinic: ComposeTenant, startsAt: string): string {
  const when = (date: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  const start = new Date(startsAt);
  const { clinicName, sessionMinutes } = clinic.tenant.settings;
  const practitioner = clinic.tenant.practitioners[0]!.name;
  return [
    `Title: ${clinicName} with ${practitioner}`,
    `Clinic: ${clinicName}`,
    `With: ${practitioner}`,
    `Start: ${when(start)}`,
    `End: ${when(new Date(start.getTime() + sessionMinutes * 60_000))}`,
    'Time zone: Europe/London (GMT)',
    `Duration: ${sessionMinutes} minutes`,
  ].join('\n');
}

export async function copyCalendar(page: Page, expected: string): Promise<void> {
  await page.getByTestId('calendar-details').waitFor();
  await expect(page.getByTestId('calendar-details')).toHaveValue(expected);
  await page.getByTestId('copy-calendar-details').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('calendar-copy-result')).toHaveText('Calendar details copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
}

export async function calendarEmail(
  context: BrowserContext,
  clinic: ComposeTenant,
  address: string,
  subject: string,
  expected: string,
  phone: string,
): Promise<void> {
  const messages = async () => {
    const response = await context.request.get(
      `${clinic.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
    );
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { messages: { ID: string; Subject: string }[] }).messages;
  };
  await expect.poll(async () => (await messages()).filter((m) => m.Subject === subject).length).toBe(1);
  const message = (await messages()).find((m) => m.Subject === subject)!;
  const response = await context.request.get(`${clinic.mailUrl}/api/v1/message/${encodeURIComponent(message.ID)}`);
  expect(response.ok()).toBe(true);
  const email = (await response.json()) as { Text: string; Attachments?: unknown[] | null };
  expect(email.Text.replace(/\r\n/g, '\n')).toContain(expected);
  expect(email.Attachments ?? []).toHaveLength(0);
  if (clinic.tenant.settings.includeContactInConfirmation) {
    expect(email.Text).toContain(`Contact phone: ${phone}`);
  } else {
    expect(email.Text).not.toContain('Contact phone:');
    expect(email.Text).not.toContain(phone);
  }
}
