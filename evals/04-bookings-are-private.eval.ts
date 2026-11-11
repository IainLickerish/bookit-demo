import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, PATIENT_2, bookSlot, londonDate, pickFreeSlot, sessionFor, step } from './support';

test("A client sees only their own bookings and cannot open anyone else's", async ({ browser }) => {
  const owner = await sessionFor(browser, PATIENT_1);
  const bookingId = await step(owner, 'Book a session as the first client', async () => {
    const slot = await pickFreeSlot(owner, londonDate(14));
    await bookSlot(owner, slot.id);
    const bookingId = await owner
      .getByTestId('upcoming-bookings')
      .getByTestId('booking-row')
      .first()
      .getAttribute('data-booking-id');
    expect(bookingId).toBeTruthy();
    return bookingId;
  });

  const stranger = await sessionFor(browser, PATIENT_2);
  await step(stranger, 'See that My bookings does not show another client’s session', async () => {
    await stranger.getByTestId('nav-my-bookings').click();
    await expect(stranger.locator(`[data-booking-id="${bookingId}"]`)).toHaveCount(0);
  });
  await step(stranger, 'Try to move another client’s session and see no booking details or free times', async () => {
    await stranger.goto(`/bookings/${bookingId}/reschedule`);
    await expect(stranger.getByTestId('current-when')).toHaveCount(0);
    await expect(stranger.getByTestId('reschedule-to')).toHaveCount(0);
  });
});

test("Only clinic staff can open the clinic's bookings, export and settings", async ({ browser, page }) => {
  const patient = await sessionFor(browser, PATIENT_1);
  await step(patient, 'Try to open staff pages as a client and see no staff controls', async () => {
    for (const path of ['/admin', '/admin/settings']) {
      await patient.goto(path);
      await expect(patient.getByTestId('admin-filter')).toHaveCount(0);
      await expect(patient.getByTestId('admin-save-settings')).toHaveCount(0);
    }
  });
  await step(patient, 'Try to download the clinic’s bookings as a client and be refused', async () => {
    expect(
      (await patient.request.get('/api/admin/export')).status(),
      'a client cannot download the export',
    ).toBeGreaterThanOrEqual(400);
  });

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Open the clinic’s bookings as staff', async () => {
    await staff.goto('/admin');
    await expect(staff.getByTestId('admin-filter')).toBeVisible();
  });
  await step(staff, 'Open the clinic’s settings as staff', async () => {
    await staff.goto('/admin/settings');
    await expect(staff.getByTestId('admin-save-settings')).toBeVisible();
  });

  await step(page, 'Open booking pages without signing in and be asked to sign in', async () => {
    for (const path of ['/bookings', '/admin', '/slots']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/sign-in/);
    }
  });
});
