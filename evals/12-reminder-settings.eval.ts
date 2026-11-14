import { expect, test, type Page } from '@playwright/test';
import { signIn, step } from './support';
import { reminderClinics } from './reminder-support';

test('Only each clinic’s staff can control its saved reminder setting, which starts enabled and leaves the other clinic unaffected.', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const clinics: {
    baseURL: string;
    domain: string;
    page: Page;
    changed: boolean;
    original?: { name: string; zone: string; hours: string; contact: boolean; reminders: boolean };
  }[] = [];
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
    await step(page, 'Keep unsaved choices and identify the invalid time zone after a failed save', async () => {
      for (const clinic of clinics) {
        const staff = clinic.page;
        clinic.original = {
          name: await staff.getByTestId('admin-clinic-name').inputValue(),
          zone: await staff.getByTestId('admin-time-zone').inputValue(),
          hours: await staff.getByTestId('admin-late-hours').inputValue(),
          contact: await staff.getByTestId('admin-include-contact').isChecked(),
          reminders: await staff.getByTestId('admin-reminders-enabled').isChecked(),
        };
        await staff.getByTestId('admin-clinic-name').fill(`${clinic.original.name} Test`);
        await staff.getByTestId('admin-time-zone').fill('London');
        await staff.getByTestId('admin-late-hours').fill('36');
        await staff.getByTestId('admin-include-contact').setChecked(!clinic.original.contact);
        await staff.getByTestId('admin-reminders-enabled').uncheck();
        await staff.getByTestId('admin-save-settings').click();
        await expect(staff.getByTestId('admin-settings-error')).toBeVisible();
        await expect(staff.getByTestId('admin-settings-error')).toBeFocused();
        await expect(staff.getByTestId('admin-time-zone')).toHaveValue('London');
        await expect(staff.getByTestId('admin-time-zone')).toHaveAttribute('aria-invalid', 'true');
        await expect(staff.getByTestId('admin-time-zone-error')).toContainText('Europe/London');
        await expect(staff.getByTestId('admin-clinic-name')).toHaveValue(`${clinic.original.name} Test`);
        await expect(staff.getByTestId('admin-late-hours')).toHaveValue('36');
        await expect(staff.getByTestId('admin-include-contact')).toBeChecked({ checked: !clinic.original.contact });
        await expect(staff.getByTestId('admin-reminders-enabled')).not.toBeChecked();
        await expect(staff.getByTestId('admin-settings-saved')).toHaveCount(0);
        const saved = await staff.context().newPage();
        try {
          await saved.goto('/admin/settings');
          await expect(saved.getByTestId('admin-clinic-name')).toHaveValue(clinic.original.name);
          await expect(saved.getByTestId('admin-time-zone')).toHaveValue(clinic.original.zone);
          await expect(saved.getByTestId('admin-late-hours')).toHaveValue(clinic.original.hours);
          await expect(saved.getByTestId('admin-include-contact')).toBeChecked({ checked: clinic.original.contact });
          await expect(saved.getByTestId('admin-reminders-enabled')).toBeChecked();
        } finally {
          await saved.close();
        }
      }
    });
    await step(
      page,
      'Correct only the time zone, save the retained choices and restore the clinic settings',
      async () => {
        for (const clinic of clinics) {
          const staff = clinic.page;
          const original = clinic.original!;
          await staff.getByTestId('admin-time-zone').fill(original.zone);
          clinic.changed = true;
          await staff.getByTestId('admin-save-settings').click();
          await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();
          await expect(staff.getByTestId('admin-settings-error')).toHaveCount(0);
          await expect(staff.getByTestId('admin-time-zone-error')).toHaveCount(0);
          await staff.goto('/admin/settings');
          await expect(staff.getByTestId('admin-clinic-name')).toHaveValue(`${original.name} Test`);
          await expect(staff.getByTestId('admin-time-zone')).toHaveValue(original.zone);
          await expect(staff.getByTestId('admin-late-hours')).toHaveValue('36');
          await expect(staff.getByTestId('admin-include-contact')).toBeChecked({ checked: !original.contact });
          await expect(staff.getByTestId('admin-reminders-enabled')).not.toBeChecked();
          await staff.getByTestId('admin-clinic-name').fill(original.name);
          await staff.getByTestId('admin-late-hours').fill(original.hours);
          await staff.getByTestId('admin-include-contact').setChecked(original.contact);
          await staff.getByTestId('admin-reminders-enabled').setChecked(original.reminders);
          await staff.getByTestId('admin-save-settings').click();
          await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();
          clinic.changed = false;
        }
      },
    );
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
          if (clinic.original) {
            await clinic.page.getByTestId('admin-clinic-name').fill(clinic.original.name);
            await clinic.page.getByTestId('admin-time-zone').fill(clinic.original.zone);
            await clinic.page.getByTestId('admin-late-hours').fill(clinic.original.hours);
            await clinic.page.getByTestId('admin-include-contact').setChecked(clinic.original.contact);
          }
          await clinic.page.getByTestId('admin-reminders-enabled').setChecked(clinic.original?.reminders ?? true);
          await clinic.page.getByTestId('admin-save-settings').click();
          await expect(clinic.page.getByTestId('admin-settings-saved')).toBeVisible();
        }
      } finally {
        await clinic.page.context().close();
      }
    }
  }
});
