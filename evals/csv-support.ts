import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { prepareComposeTenant, type ComposeTenant } from '../tests/helpers/compose';
import { evalNow, signIn } from './support';

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

// These names exist only in the two fresh export-check copies, never in the normal demo seed.
// The second uses decomposed accents. The third exercises other alphabets, CSV quoting and formula protection.
export const EXPORT_CLIENTS = ['Zoë Brontë', 'Zoe\u0308 Bronte\u0308', '=架空, "Δοκιμή"\nعميل تجريبي'];

// Only the formula-like fixture name needs the existing spreadsheet text prefix.
export const downloadedName = (name: string): string => (name === EXPORT_CLIENTS[2] ? `'${name}` : name);

/** Reuse the existing isolated Compose fixture, supplying only fictional export test data. */
export async function prepareExportClinic(name: 'acme' | 'beacon'): Promise<ComposeTenant> {
  const clinic = await prepareComposeTenant(name);
  for (const [index, account] of clinic.tenant.accounts.filter((account) => account.role === 'patient').entries()) {
    account.name = EXPORT_CLIENTS[index]!;
  }
  clinic.tenant.practitioners.push({ ...clinic.tenant.practitioners[0]!, name: 'Robin Export Test' });
  const tenantFile = path.join(clinic.directory, `${name}.json`);
  writeFileSync(tenantFile, JSON.stringify(clinic.tenant));
  writeFileSync(clinic.clockFile, JSON.stringify({ now: evalNow().toISOString() }));
  const overrideFile = path.join(clinic.directory, 'compose.override.json');
  const override = JSON.parse(readFileSync(overrideFile, 'utf8')) as {
    services: Record<string, { volumes?: string[] }>;
  };
  for (const service of ['seed', 'bookit']) {
    override.services[service]!.volumes!.push(`${tenantFile}:/app/tenants/${name}.json:ro`);
  }
  writeFileSync(overrideFile, JSON.stringify(override));
  return clinic;
}

export async function clinicPage(browser: Browser, clinic: ComposeTenant): Promise<Page> {
  // Each clinic's context has its own origin and cookies, even though both hosts are loopback.
  const context = await browser.newContext({ baseURL: clinic.url });
  return context.newPage();
}

export async function signInToClinic(page: Page, clinic: ComposeTenant, localPart = 'admin'): Promise<void> {
  const email = clinic.tenant.accounts.find((account) => account.email.startsWith(`${localPart}@`))!.email;
  await signIn(page, email, clinic.accounts[email]);
}

export async function bookExportBooking(
  page: Page,
  clinic: ComposeTenant,
  date: string,
  practitioner = clinic.tenant.practitioners[0]!.name,
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
