import { expect, type Page } from '@playwright/test';
import { PRACTITIONER } from './support';

export async function fillPeriod(page: Page, start: string, end: string, reason: string) {
  await expect(page.getByTestId('admin-blocked-time-link'), 'Clinic bookings offers Block time').toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId('admin-blocked-time-link').click({ timeout: 10_000 });
  await expect(
    page.getByRole('heading', { name: 'Blocked time', exact: true }),
    'The staff blocked time page opens',
  ).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER }, { timeout: 10_000 });
  await page.getByTestId('block-start').fill(start, { timeout: 10_000 });
  await page.getByTestId('block-end').fill(end, { timeout: 10_000 });
  await page.getByTestId('block-reason').fill(reason, { timeout: 10_000 });
}
