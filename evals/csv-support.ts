import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn } from './support';

/** A supplied demo copy. Owner checks never build, seed or reach into its database. */
export interface ExportClinic {
  name: 'acme' | 'beacon';
  now: string;
  label: string;
  domain: string;
  url: string;
  accounts: Record<string, string>;
  clients: string[];
  practitioners: string[];
}

export const CSV_HEADINGS = [
  'Booking ID',
  'Patient',
  'Practitioner',
  'Start (UTC)',
  'End (UTC)',
  'Status',
  'Late cancellation',
  'Phone',
];

// The existing CSV safety rule marks formula-like values as spreadsheet text.
export const downloadedName = (name: string): string =>
  /^[\s\u0000-\u001f]*[=+\-@]/u.test(name) || /^[\t\r\n]/u.test(name) ? `'${name}` : name;

export async function clinicPage(browser: Browser, clinic: ExportClinic): Promise<Page> {
  // Each clinic's context has its own origin and cookies, even though both hosts are loopback.
  const context = await browser.newContext({ baseURL: clinic.url });
  return context.newPage();
}

export async function signInToClinic(page: Page, clinic: ExportClinic, localPart = 'admin'): Promise<void> {
  const email = localPart === 'admin' ? `admin@${clinic.domain}` : `${localPart}@patients.${clinic.domain}`;
  await signIn(page, email, clinic.accounts[email]);
}

export async function bookExportBooking(
  page: Page,
  clinic: ExportClinic,
  date: string,
  practitioner = clinic.practitioners[0]!,
  phone = '',
): Promise<{ id: string; when: string }> {
  await page.goto('/slots');
  await page.getByTestId('practitioner-select').selectOption({ label: practitioner });
  await page.getByTestId('date-input').fill(date);
  await page.getByTestId('show-slots').click();
  await page.getByTestId('slot-link').first().click();
  const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  await page.getByTestId('book-phone').fill(phone);
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
  const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
  const id = await row.getAttribute('data-booking-id');
  expect(id).toBeTruthy();
  return { id: id!, when };
}

/** Parse fully quoted RFC 4180 fields, including embedded commas, quotes and newlines. */
export function csvRecords(text: string): string[][] {
  const source = text.replace(/^\uFEFF/u, '');
  const field = /"((?:[^"]|"")*)"(,|\r\n)/gy;
  const records: string[][] = [];
  let record: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    field.lastIndex = offset;
    const match = field.exec(source);
    expect(match, 'every CSV field is quoted and every record ends with CRLF').not.toBeNull();
    record.push(match![1]!.replaceAll('""', '"'));
    offset = field.lastIndex;
    if (match![2] === '\r\n') {
      records.push(record);
      record = [];
    }
  }
  expect(record, 'there is no incomplete CSV record').toEqual([]);
  return records;
}

export async function downloadBookings(page: Page): Promise<string[][]> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.getByTestId('admin-export').click(),
  ]);
  expect(download.suggestedFilename()).toBe('bookings.csv');
  expect(await download.failure()).toBeNull();
  const file = await download.path();
  expect(file).toBeTruthy();
  const bytes = readFileSync(file!);
  await test.info().attach('Fictional bookings.csv', { body: bytes, contentType: 'text/csv' });
  expect([...bytes.subarray(0, 3)], 'the spreadsheet can recognise UTF-8').toEqual([0xef, 0xbb, 0xbf]);
  const records = csvRecords(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  expect(records[0]).toEqual(CSV_HEADINGS);
  for (const record of records) expect(record).toHaveLength(CSV_HEADINGS.length);
  return records.slice(1);
}

export async function visibleReferences(page: Page): Promise<string[]> {
  return page
    .getByTestId('admin-booking-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-booking-id')!));
}

export async function settingsValues(page: Page) {
  return {
    name: await page.getByTestId('admin-clinic-name').inputValue(),
    zone: await page.getByTestId('admin-time-zone').inputValue(),
    hours: await page.getByTestId('admin-late-hours').inputValue(),
    contact: await page.getByTestId('admin-include-contact').isChecked(),
  };
}
