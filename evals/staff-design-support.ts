import { expect, type Locator, type Page } from '@playwright/test';

export async function expectWhiteCard(card: Locator): Promise<void> {
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
}

export async function expectPageToFit(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const frame = await page.getByTestId('page-content').boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.x).toBeGreaterThanOrEqual(0);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

export async function filterStaffDay(page: Page, date: string, status: string): Promise<void> {
  await page.getByTestId('admin-date').fill(date);
  await page.getByTestId('admin-status').selectOption(status);
  await page.getByTestId('admin-filter').click();
  await expect(page.getByTestId('admin-date')).toHaveValue(date);
  await expect(page.getByTestId('admin-status')).toHaveValue(status);
}

export async function expectTableToScroll(page: Page): Promise<void> {
  const region = page.getByTestId('admin-table-scroll');
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveCSS('overflow-x', 'auto');
  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await region.scrollIntoViewIfNeeded();
  await region.focus();
  const before = await region.evaluate((element) => element.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  await expect(region).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
  await expect(region).toHaveCSS('outline-style', 'solid');
  await expectPageToFit(page);
}
