import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import { mailTo } from './support';

export function calendarField(file: string, field: string): string {
  const line = file
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .find((line) => line.startsWith(`${field}:`));
  expect(line, `the calendar contains ${field}`).toBeTruthy();
  return line!.slice(field.length + 1);
}

export function calendarInstant(file: string, field: string): Date {
  const value = calendarField(file, field);
  expect(value).toMatch(/^\d{8}T\d{6}Z$/);
  return new Date(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
}

export async function downloadCalendar(page: Page, link: Locator): Promise<string> {
  const downloaded = page.waitForEvent('download');
  await link.click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('booking.ics');
  const path = await file.path();
  expect(path).toBeTruthy();
  return readFile(path!, 'utf8');
}

/** Read the new confirmation for this booking from the demo inbox, as its recipient. */
export async function emailedCalendar(address: string, bookingId: string, seen: Set<string>) {
  const base = process.env.EVAL_MAIL_URL!;
  let found: { Text: string; Attachments: { FileName: string; PartID: string; ContentType: string }[] } | undefined;
  let messageId = '';
  await expect
    .poll(
      async () => {
        for (const message of (await mailTo(address)).filter((message) => !seen.has(message.ID))) {
          const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
          expect(response.ok).toBe(true);
          const email = (await response.json()) as NonNullable<typeof found>;
          if (email.Text.includes(`Booking reference: ${bookingId}`)) {
            found = email;
            messageId = message.ID;
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000, message: 'a confirmation arrives for this booking' },
    )
    .toBe(true);
  const attachment = found!.Attachments.find((file) => file.FileName === 'booking.ics');
  expect(attachment, 'the confirmation includes a calendar file').toBeTruthy();
  expect(attachment!.ContentType).toContain('text/calendar');
  const response = await fetch(
    `${base}/api/v1/message/${encodeURIComponent(messageId)}/part/${encodeURIComponent(attachment!.PartID)}`,
  );
  expect(response.ok).toBe(true);
  return { text: found!.Text, file: await response.text() };
}
