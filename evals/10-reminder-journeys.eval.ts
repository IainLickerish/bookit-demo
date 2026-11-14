import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, signIn, step } from './support';

test('Clinic staff can switch reminder emails off and on, and the choice stays saved', async ({ page, browser }) => {
  await step(page, 'Sign in as clinic staff and open settings', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, ADMIN);
    await page.goto('/admin/settings');
    await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    await expect(page.getByTestId('reminders-hint')).toContainText('23 to 24 hours');
  });
  try {
    await step(page, 'Switch reminders off and see the saved choice after reopening settings', async () => {
      await page.getByTestId('admin-reminders-enabled').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await page.goto('/admin/settings');
      await expect(page.getByTestId('admin-reminders-enabled')).not.toBeChecked();
    });
    const client = await (await browser.newContext()).newPage();
    await step(client, 'Sign in as a client and see that reminder settings are reserved for staff', async () => {
      await signIn(client, PATIENT_2);
      await client.goto('/admin/settings');
      await expect(client.getByTestId('admin-reminders-enabled')).toHaveCount(0);
      await expect(client.getByTestId('admin-save-settings')).toHaveCount(0);
    });
    await client.context().close();
  } finally {
    await step(page, 'Switch reminders back on and see the saved choice after reopening settings', async () => {
      await page.goto('/admin/settings');
      await page.getByTestId('admin-reminders-enabled').check();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await page.goto('/admin/settings');
      await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    });
  }
});
