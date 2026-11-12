import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, bookSlot, londonDate, pickFreeSlot, sessionFor, step } from './support';

const CLIENT = 'Zoë Brontë';

test("Clinic staff can find a client's booking and change the clinic's settings", async ({ browser }) => {
  const date = londonDate(15);
  const client = await sessionFor(browser, PATIENT_1);
  await step(client, 'Book a free session as a client', async () => {
    await bookSlot(client, (await pickFreeSlot(client, date)).id);
  });

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, "Open the clinic's bookings for that day and find the client's booking", async () => {
    await staff.getByTestId('nav-admin').click();
    await expect(staff.getByRole('heading', { name: 'Clinic bookings' })).toBeVisible();
    await staff.getByTestId('admin-date').fill(date);
    await staff.getByTestId('admin-filter').click();
    await expect(staff.getByTestId('admin-booking-row').filter({ hasText: CLIENT })).toContainText('Confirmed');
  });

  const name = await step(staff, "Change the clinic's name and see it saved", async () => {
    await staff.getByTestId('admin-settings-link').click();
    const before = await staff.getByTestId('admin-clinic-name').inputValue();
    await staff.getByTestId('admin-clinic-name').fill(`${before} Test`);
    await staff.getByTestId('admin-save-settings').click();
    await expect(staff.getByTestId('admin-settings-saved')).toHaveText('Clinic settings saved.');
    await expect(staff.getByTestId('clinic-name')).toHaveText(`${before} Test`);
    return before;
  });
  // The other checks expect the clinic as it was, so its name is put back.
  await step(staff, "Put the clinic's name back", async () => {
    await staff.getByTestId('admin-clinic-name').fill(name);
    await staff.getByTestId('admin-save-settings').click();
    await expect(staff.getByTestId('clinic-name')).toHaveText(name);
  });
});
