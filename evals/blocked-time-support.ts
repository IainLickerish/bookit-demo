import type { Page } from '@playwright/test';
import { PRACTITIONER } from './support';

export async function fillPeriod(page: Page, start: string, end: string, reason: string) {
  await page.getByTestId('admin-blocked-time-link').click();
  await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await page.getByTestId('block-start').fill(start);
  await page.getByTestId('block-end').fill(end);
  await page.getByTestId('block-reason').fill(reason);
}
