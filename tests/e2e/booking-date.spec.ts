import { expect, test } from '@playwright/test';
import { signIn } from './support';

test('the booking date field follows day navigation and a chosen date', async ({ page }) => {
  await signIn(page, 'patient1@patients.example.test');
  await page.goto('/slots?date=2026-11-17');
  const date = page.getByTestId('date-input');
  const heading = page.getByTestId('shown-date');
  await expect(date).toHaveValue('2026-11-17');

  // Editing the field makes the browser retain its value across client navigation.
  await date.fill('2026-11-17');
  await page.getByTestId('next-day').click();
  await expect(heading).toContainText('18 November 2026');
  await expect(date).toHaveValue('2026-11-18');
  await expect(page.getByTestId('slot-link').first()).toContainText('18 Nov 2026');

  await date.fill('2026-11-19');
  await page.getByTestId('previous-day').click();
  await expect(heading).toContainText('17 November 2026');
  await expect(date).toHaveValue('2026-11-17');
  await expect(page.getByTestId('slot-link').first()).toContainText('17 Nov 2026');

  await date.fill('2026-11-19');
  await page.getByTestId('show-slots').click();
  await expect(heading).toContainText('19 November 2026');
  await expect(date).toHaveValue('2026-11-19');
  await expect(page.getByTestId('slot-link').first()).toContainText('19 Nov 2026');
  await page.getByTestId('next-day').click();
  await expect(heading).toContainText('20 November 2026');
  await expect(date).toHaveValue('2026-11-20');
});
