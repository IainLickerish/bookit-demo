import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, PATIENT_2, bookSlot, londonDate, pickFreeSlot, sessionFor } from './support';

test("A client sees only their own bookings and cannot open anyone else's", async ({ browser }) => {
  const owner = await sessionFor(browser, PATIENT_1);
  const slot = await pickFreeSlot(owner, londonDate(14));
  await bookSlot(owner, slot.id);
  const bookingId = await owner
    .getByTestId('upcoming-bookings')
    .getByTestId('booking-row')
    .first()
    .getAttribute('data-booking-id');
  expect(bookingId).toBeTruthy();

  const stranger = await sessionFor(browser, PATIENT_2);
  await stranger.getByTestId('nav-my-bookings').click();
  await expect(stranger.locator(`[data-booking-id="${bookingId}"]`)).toHaveCount(0);
  await stranger.goto(`/bookings/${bookingId}/reschedule`);
  await expect(stranger.getByTestId('current-when')).toHaveCount(0);
  await expect(stranger.getByTestId('reschedule-to')).toHaveCount(0);
});

test("Only clinic staff can open the clinic's bookings, export and settings", async ({ browser, page }) => {
  const patient = await sessionFor(browser, PATIENT_1);
  for (const path of ['/admin', '/admin/settings']) {
    await patient.goto(path);
    await expect(patient.getByTestId('admin-filter')).toHaveCount(0);
    await expect(patient.getByTestId('admin-save-settings')).toHaveCount(0);
  }
  expect(
    (await patient.request.get('/api/admin/export')).status(),
    'a client cannot download the export',
  ).toBeGreaterThanOrEqual(400);

  const staff = await sessionFor(browser, ADMIN);
  await staff.goto('/admin');
  await expect(staff.getByTestId('admin-filter')).toBeVisible();
  await staff.goto('/admin/settings');
  await expect(staff.getByTestId('admin-save-settings')).toBeVisible();

  // Anyone not signed in is sent to sign in.
  for (const path of ['/bookings', '/admin', '/slots']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  }
});
