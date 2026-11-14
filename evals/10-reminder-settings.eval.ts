import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, sessionFor, step } from './support';

test('Staff can save reminders as on or off and see the saved choice when reopening clinic settings.', async ({
  browser,
}) => {
  const staff = await sessionFor(browser, ADMIN);
  let original = 'off';
  await step(staff, 'Open clinic settings and read the reminder choice', async () => {
    await staff.getByTestId('nav-admin').click();
    await staff.getByTestId('admin-settings-link').click();
    await expect(staff.getByTestId('admin-reminders')).toBeVisible();
    original = await staff.getByTestId('admin-reminders').inputValue();
  });
  try {
    await step(staff, 'Switch reminders on and save', async () => {
      await staff.getByTestId('admin-reminders').selectOption('on');
      await staff.getByTestId('admin-save-settings').click();
      await expect(staff.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await step(staff, 'Reopen settings and see reminders on', async () => {
      await staff.getByRole('link', { name: 'Back to bookings' }).click();
      await staff.getByTestId('admin-settings-link').click();
      await expect(staff.getByTestId('admin-reminders')).toHaveValue('on');
    });
    await step(staff, 'Switch reminders off and save', async () => {
      await staff.getByTestId('admin-reminders').selectOption('off');
      await staff.getByTestId('admin-save-settings').click();
      await expect(staff.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await step(staff, 'Reopen settings and see reminders off', async () => {
      await staff.getByRole('link', { name: 'Back to bookings' }).click();
      await staff.getByTestId('admin-settings-link').click();
      await expect(staff.getByTestId('admin-reminders')).toHaveValue('off');
    });
  } finally {
    await step(staff, 'Restore the original reminder choice', async () => {
      await staff.goto('/admin/settings');
      await staff.getByTestId('admin-reminders').selectOption(original);
      await staff.getByTestId('admin-save-settings').click();
      await expect(staff.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await staff.context().close();
  }
});

test('Only signed-in staff of the current clinic can view or change its reminder choice.', async ({ browser }) => {
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'See that clinic staff have the reminder setting', async () => {
    await staff.goto('/admin/settings');
    await expect(staff.getByTestId('admin-reminders')).toBeVisible();
    await expect(staff.getByTestId('admin-save-settings')).toBeVisible();
  });
  await staff.context().close();
  const visitor = await (await browser.newContext()).newPage();
  await step(visitor, 'Try opening clinic settings while signed out', async () => {
    await visitor.goto('/admin/settings');
    await expect(visitor).toHaveURL(/\/auth\/sign-in$/);
    await expect(visitor.getByTestId('admin-reminders')).toHaveCount(0);
    await expect(visitor.getByTestId('admin-save-settings')).toHaveCount(0);
  });
  const client = await sessionFor(browser, PATIENT_2);
  await step(client, 'Try opening clinic settings as a client', async () => {
    await client.goto('/admin/settings');
    await expect(client).toHaveURL(/\/bookings$/);
    await expect(client.getByTestId('admin-reminders')).toHaveCount(0);
    await expect(client.getByTestId('admin-save-settings')).toHaveCount(0);
  });
  await step(client, 'See a way to continue managing your own bookings', async () => {
    await expect(client.getByTestId('nav-book')).toBeVisible();
    await expect(client.getByTestId('nav-admin')).toHaveCount(0);
  });
  await visitor.context().close();
  await client.context().close();
});

test('Staff can correct a failed settings submission without re-entering their reminder choice.', async ({
  browser,
}) => {
  const staff = await sessionFor(browser, ADMIN);
  const original = await step(staff, 'Open settings and read the saved values', async () => {
    await staff.goto('/admin/settings');
    return {
      name: await staff.getByTestId('admin-clinic-name').inputValue(),
      timeZone: await staff.getByTestId('admin-time-zone').inputValue(),
      reminders: await staff.getByTestId('admin-reminders').inputValue(),
    };
  });
  const choice = original.reminders === 'on' ? 'off' : 'on';
  try {
    await step(staff, 'Change the reminder choice and enter an invalid time zone', async () => {
      await staff.getByTestId('admin-reminders').selectOption(choice);
      await staff.getByTestId('admin-time-zone').fill('Not/AZone');
      await staff.getByTestId('admin-clinic-name').fill('Reminder settings check');
      await staff.getByTestId('admin-save-settings').click();
    });
    await step(staff, 'See what needs correcting with the entered choices still present', async () => {
      await expect(staff.getByTestId('admin-settings-error')).toContainText('valid IANA time zone');
      await expect(staff.getByTestId('admin-settings-saved')).toHaveCount(0);
      await expect(staff.getByTestId('admin-reminders')).toHaveValue(choice);
      await expect(staff.getByTestId('admin-time-zone')).toHaveValue('Not/AZone');
      await expect(staff.getByTestId('admin-clinic-name')).toHaveValue('Reminder settings check');
    });
    await step(staff, 'Correct only the time zone and save the retained choices', async () => {
      await staff.getByTestId('admin-time-zone').fill(original.timeZone);
      await staff.getByTestId('admin-save-settings').click();
      await expect(staff.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await step(staff, 'Reopen settings and see the corrected submission saved', async () => {
      await staff.getByRole('link', { name: 'Back to bookings' }).click();
      await staff.getByTestId('admin-settings-link').click();
      await expect(staff.getByTestId('admin-reminders')).toHaveValue(choice);
      await expect(staff.getByTestId('admin-time-zone')).toHaveValue(original.timeZone);
      await expect(staff.getByTestId('admin-clinic-name')).toHaveValue('Reminder settings check');
    });
  } finally {
    await step(staff, 'Restore the original clinic settings', async () => {
      await staff.goto('/admin/settings');
      await staff.getByTestId('admin-reminders').selectOption(original.reminders);
      await staff.getByTestId('admin-time-zone').fill(original.timeZone);
      await staff.getByTestId('admin-clinic-name').fill(original.name);
      await staff.getByTestId('admin-save-settings').click();
      await expect(staff.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    });
    await staff.context().close();
  }
});
