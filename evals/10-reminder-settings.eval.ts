import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, signIn, step } from './support';

test.use({ actionTimeout: 10_000 });

test('Clinic staff can save reminders off and on and see each choice after reopening settings', async ({ page }) => {
  await step(page, 'Sign in as clinic staff', async () => {
    await signIn(page, ADMIN);
  });
  const original = await step(page, 'Open clinic settings and read the reminder choice', async () => {
    await page.getByTestId('nav-admin').click();
    await page.getByTestId('admin-settings-link').click();
    await expect(page.getByRole('checkbox', { name: 'Enable reminder emails' })).toBeVisible();
    return page.getByTestId('admin-reminders-enabled').isChecked();
  });
  try {
    await step(page, 'Switch reminders off and save settings', async () => {
      await page.getByTestId('admin-reminders-enabled').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await step(page, 'Reopen settings and see reminders switched off', async () => {
      await page.getByTestId('nav-admin').click();
      await page.getByTestId('admin-settings-link').click();
      await expect(page.getByTestId('admin-reminders-enabled')).not.toBeChecked();
    });
    await step(page, 'Switch reminders on and save settings', async () => {
      await page.getByTestId('admin-reminders-enabled').check();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await step(page, 'Reopen settings and see reminders switched on', async () => {
      await page.getByTestId('nav-admin').click();
      await page.getByTestId('admin-settings-link').click();
      await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    });
  } finally {
    await step(page, 'Restore the original reminder choice', async () => {
      await page.goto('/admin/settings');
      await page.getByTestId('admin-reminders-enabled').setChecked(original);
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
    });
  }
});

test('Visitors and clients cannot view or change the reminder setting', async ({ page, context }) => {
  const otherTab = await context.newPage();
  let original = true;
  await step(page, 'Sign in as staff and save reminders switched on', async () => {
    await signIn(page, ADMIN);
    await page.goto('/admin/settings');
    original = await page.getByTestId('admin-reminders-enabled').isChecked();
    await page.getByTestId('admin-reminders-enabled').check();
    await page.getByTestId('admin-save-settings').click();
    await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
  });
  try {
    await step(otherTab, 'Sign out in another tab and try to open clinic settings', async () => {
      await otherTab.goto('/admin');
      await otherTab.getByTestId('sign-out').click();
      await otherTab.goto('/admin/settings');
      await expect(otherTab).toHaveURL(/\/auth\/sign-in$/);
      await expect(otherTab.getByTestId('admin-reminders-enabled')).toHaveCount(0);
    });
    await step(page, 'Try to save the old settings form while signed out', async () => {
      await page.getByTestId('admin-reminders-enabled').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
    });
    await step(page, 'Sign in as staff and check the reminder choice was not changed', async () => {
      await signIn(page, ADMIN);
      await page.goto('/admin/settings');
      await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    });
    await step(otherTab, 'Sign in as a client in another tab and try to open settings', async () => {
      await otherTab.goto('/admin');
      await otherTab.getByTestId('sign-out').click();
      await signIn(otherTab, PATIENT_1);
      await otherTab.goto('/admin/settings');
      await expect(otherTab).toHaveURL(/\/bookings$/);
      await expect(otherTab.getByTestId('admin-reminders-enabled')).toHaveCount(0);
    });
    await step(page, 'Try to save the old staff form as a client', async () => {
      await page.getByTestId('admin-reminders-enabled').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page).toHaveURL(/\/bookings$/);
    });
    await step(page, 'Sign in as staff and check the client did not change reminders', async () => {
      await page.getByTestId('sign-out').click();
      await signIn(page, ADMIN);
      await page.goto('/admin/settings');
      await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    });
  } finally {
    await step(page, 'Restore the original reminder choice', async () => {
      await page.goto('/admin/settings');
      if (!(await page.getByTestId('admin-reminders-enabled').isVisible())) {
        await signIn(page, ADMIN);
        await page.goto('/admin/settings');
      }
      await page.getByTestId('admin-reminders-enabled').setChecked(original);
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await otherTab.close();
    });
  }
});
