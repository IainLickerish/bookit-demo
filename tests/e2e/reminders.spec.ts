import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from '../helpers/clinic';
import { query, signIn } from './support';

test.use({ trace: 'off' });

test('Clinic staff can turn reminder emails on and off in Clinic settings', async ({ page, browser }) => {
  const [staff] = await query<{ email: string }>('select email from "user" where role = \'admin\'');
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill(staff!.email);
  await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await expect(page).toHaveURL(new URL('/', page.url()).href);

  await page.goto('/admin/settings');
  const reminderSetting = page.getByRole('checkbox', { name: 'Send reminder emails' });
  await expect(reminderSetting).not.toBeChecked();
  await reminderSetting.check();
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
  await page.goto('/admin/settings');
  await expect(reminderSetting).toBeChecked();

  const patient = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await signIn(patient, 'patient1@patients.example.test');
    await patient.goto('/admin/settings');
    await expect(patient).toHaveURL(/\/bookings$/);
    await expect(patient.getByTestId('admin-reminders-enabled')).toHaveCount(0);
  } finally {
    await patient.close();
  }

  await reminderSetting.uncheck();
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
  await page.goto('/admin/settings');
  await expect(reminderSetting).not.toBeChecked();
});
