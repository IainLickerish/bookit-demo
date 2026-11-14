import { expect, test } from '@playwright/test';
import { ADMIN, signIn, step } from './support';

test('Clinic settings keeps an unavailable-save notice and the existing form together in one white card.', async ({
  page,
}) => {
  await step(page, 'Open clinic settings as staff on a phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await page.getByTestId('admin-settings-link').click();
    await expect(page.getByRole('heading', { name: 'Clinic settings', exact: true })).toBeVisible();
  });
  await step(
    page,
    'Open the existing unavailable-save state and see its message inside the settings card',
    async () => {
      await page.goto('/admin/settings?error=unavailable');
      const card = page.getByTestId('admin-settings-card');
      await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(card).toHaveCSS('border-radius', '20px');
      await expect(card.getByRole('alert')).toContainText('Settings could not be saved. Please try again.');
      await expect(card.getByTestId('admin-settings-form')).toBeVisible();
      await expect(card.getByTestId('admin-settings-form')).toHaveCSS('box-shadow', 'none');
      await expect(card.getByTestId('admin-settings-form')).toHaveCSS('border-radius', '0px');
      await expect(card.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    },
  );
  await step(page, 'Use the existing back link to return to clinic bookings', async () => {
    await page.getByTestId('admin-back-to-bookings').click();
    await expect(page.getByRole('heading', { name: 'Clinic bookings', exact: true })).toBeVisible();
  });
});
