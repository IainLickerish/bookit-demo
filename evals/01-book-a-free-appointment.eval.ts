import { expect, test } from '@playwright/test';
import { PATIENT_1, londonDate, mailTo, pickFreeSlot, signIn, step } from './support';

test('A client can book a free appointment and gets a confirmation email', async ({ page }) => {
  const before = await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_1);
    return (await mailTo(PATIENT_1)).length;
  });
  const slot = await step(page, 'Choose a free session and check its time', async () => {
    const slot = await pickFreeSlot(page, londonDate(10));
    await page.getByTestId('slot-link').first().click();
    await expect(page.getByTestId('book-when')).toContainText(slot.time);
    return slot;
  });
  await step(page, 'Confirm the booking', async () => {
    await page.getByTestId('confirm-booking').click();
  });

  await step(page, 'See the confirmed session in My bookings', async () => {
    await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
    await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
    const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: slot.time });
    await expect(row.first().getByTestId('booking-status')).toHaveText('Confirmed');
  });
  await step(page, 'Receive a confirmation email', async () => {
    await expect.poll(async () => (await mailTo(PATIENT_1)).length, { timeout: 15_000 }).toBeGreaterThan(before);
  });
});
