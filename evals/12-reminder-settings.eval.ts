import { expect, test, type Page } from '@playwright/test';
import { signIn, step } from './support';
import { reminderClinics } from './reminder-support';

test('Only each clinic’s staff can control its saved reminder setting, which starts enabled and leaves the other clinic unaffected.', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const clinics: { baseURL: string; domain: string; page: Page; changed: boolean }[] = [];
  try {
    for (const clinic of reminderClinics(baseURL!)) {
      const context = await browser.newContext({ baseURL: clinic.baseURL, viewport: { width: 1280, height: 900 } });
      clinics.push({ ...clinic, page: await context.newPage(), changed: false });
    }
    const page = clinics[0]!.page;
    await step(page, 'Sign in as staff and see reminder emails start switched on', async () => {
      for (const clinic of clinics) {
        await signIn(clinic.page, `admin@${clinic.domain}`);
        await clinic.page.goto('/admin/settings');
        await expect(clinic.page.getByTestId('admin-reminders-enabled')).toBeChecked();
        await expect(clinic.page.getByTestId('reminders-hint')).toContainText('23 to 24 hours');
      }
    });
    await step(page, 'Switch reminders off, reopen settings and see the saved choice', async () => {
      for (const clinic of clinics) {
        await clinic.page.getByTestId('admin-reminders-enabled').uncheck();
        clinic.changed = true;
        await clinic.page.getByTestId('admin-save-settings').click();
        await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
        await clinic.page.goto('/admin/settings');
        await expect(clinic.page.getByTestId('admin-reminders-enabled')).not.toBeChecked();
        for (const other of clinics.filter((other) => other !== clinic)) {
          await other.page.goto('/admin/settings');
          await expect(other.page.getByTestId('admin-reminders-enabled')).toBeChecked();
        }
        await clinic.page.getByTestId('admin-reminders-enabled').check();
        await clinic.page.getByTestId('admin-save-settings').click();
        await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
        clinic.changed = false;
      }
    });
    await step(page, 'See reminders are enabled again after reopening settings', async () => {
      for (const clinic of clinics) {
        await clinic.page.goto('/admin/settings');
        await expect(clinic.page.getByTestId('admin-reminders-enabled')).toBeChecked();
      }
    });
    await step(page, 'See that clients cannot open the staff settings', async () => {
      for (const clinic of clinics) {
        const context = await browser.newContext({ baseURL: clinic.baseURL });
        try {
          const client = await context.newPage();
          await signIn(client, `patient2@patients.${clinic.domain}`);
          await client.goto('/admin/settings');
          await expect(client.getByTestId('admin-reminders-enabled')).toHaveCount(0);
          await expect(client.getByTestId('admin-save-settings')).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    });
    await step(page, 'See settings require sign-in, including staff visiting another supplied clinic', async () => {
      for (const clinic of clinics) {
        const context = await browser.newContext({ baseURL: clinic.baseURL });
        try {
          const visitor = await context.newPage();
          await visitor.goto('/admin/settings');
          await expect(visitor).toHaveURL(/\/auth\/sign-in/);
          await expect(visitor.getByTestId('admin-reminders-enabled')).toHaveCount(0);
        } finally {
          await context.close();
        }
        for (const other of clinics.filter((other) => other !== clinic)) {
          await clinic.page.goto(`${other.baseURL}/admin/settings`);
          await expect(clinic.page).toHaveURL(/\/auth\/sign-in/);
          await expect(clinic.page.getByTestId('admin-reminders-enabled')).toHaveCount(0);
        }
      }
    });
  } finally {
    for (const clinic of clinics) {
      try {
        if (clinic.changed) {
          await clinic.page.goto(`${clinic.baseURL}/admin/settings`);
          await clinic.page.getByTestId('admin-reminders-enabled').check();
          await clinic.page.getByTestId('admin-save-settings').click();
          await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
        }
      } finally {
        await clinic.page.context().close();
      }
    }
  }
});
