import { expect, test } from '@playwright/test';
import { ADMIN, sessionFor } from './support';

test('Clinic staff can switch appointment reminder emails off and on', async ({ browser }) => {
  const page = await sessionFor(browser, ADMIN);
  await page.goto('/admin/settings');
  const reminders = page.getByRole('checkbox', { name: 'Send appointment reminder emails', exact: true });
  const originallyEnabled = await reminders.isChecked();
  try {
    await reminders.uncheck();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
    await page.reload();
    await expect(reminders).not.toBeChecked();

    await reminders.check();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
    await page.reload();
    await expect(reminders).toBeChecked();
  } finally {
    await reminders.setChecked(originallyEnabled);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.context().close();
  }
});
