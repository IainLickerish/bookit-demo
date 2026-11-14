import { expect, test, type Page } from '@playwright/test';
import { signIn, step } from './support';

test('Only each clinic’s staff can control its saved reminder setting, which starts enabled and leaves the other clinic unaffected.', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const clinics: { baseURL: string; domain: string; page: Page }[] = [];
  for (const clinic of [
    { baseURL: process.env.EVAL_BASE_URL ?? 'http://localhost:4101', domain: 'acmephysio.test' },
    { baseURL: process.env.EVAL_BEACON_BASE_URL ?? 'http://localhost:4201', domain: 'beacondental.test' },
  ]) {
    const context = await browser.newContext({ baseURL: clinic.baseURL, viewport: { width: 1280, height: 900 } });
    clinics.push({ ...clinic, page: await context.newPage() });
  }
  const page = clinics[0]!.page;
  try {
    await step(page, 'Sign in as each clinic’s staff and see reminders start switched on', async () => {
      for (const clinic of clinics) {
        await signIn(clinic.page, `admin@${clinic.domain}`);
        await clinic.page.goto('/admin/settings');
        await expect(clinic.page.getByTestId('admin-reminders-enabled')).toBeChecked();
        await expect(clinic.page.getByTestId('reminders-hint')).toContainText('23 to 24 hours');
      }
    });
    for (const [index, clinic] of clinics.entries()) {
      await step(
        clinic.page,
        'Switch reminders off, reopen settings and see the other clinic is still on',
        async () => {
          await clinic.page.getByTestId('admin-reminders-enabled').uncheck();
          await clinic.page.getByTestId('admin-save-settings').click();
          await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
          await clinic.page.goto('/admin/settings');
          await expect(clinic.page.getByTestId('admin-reminders-enabled')).not.toBeChecked();
          const other = clinics[1 - index]!;
          await other.page.goto('/admin/settings');
          await expect(other.page.getByTestId('admin-reminders-enabled')).toBeChecked();
        },
      );
      await step(clinic.page, 'Switch reminders back on and see the choice stays saved', async () => {
        await clinic.page.getByTestId('admin-reminders-enabled').check();
        await clinic.page.getByTestId('admin-save-settings').click();
        await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
        await clinic.page.goto('/admin/settings');
        await expect(clinic.page.getByTestId('admin-reminders-enabled')).toBeChecked();
      });
    }
    await step(page, 'See that clients in both clinics cannot change reminder settings', async () => {
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
    await step(page, 'See that each staff sign-in cannot open the other clinic’s settings', async () => {
      for (const [index, clinic] of clinics.entries()) {
        await clinic.page.goto(`${clinics[1 - index]!.baseURL}/admin/settings`);
        await expect(clinic.page).toHaveURL(/\/auth\/sign-in/);
        await expect(clinic.page.getByTestId('admin-reminders-enabled')).toHaveCount(0);
        await expect(clinic.page.getByTestId('admin-save-settings')).toHaveCount(0);
      }
    });
  } finally {
    for (const clinic of clinics) {
      try {
        await clinic.page.goto(`${clinic.baseURL}/admin/settings`);
        await clinic.page.getByTestId('admin-reminders-enabled').check();
        await clinic.page.getByTestId('admin-save-settings').click();
        await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
      } finally {
        await clinic.page.context().close();
      }
    }
  }
});
