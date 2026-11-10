import { expect, test } from '@playwright/test';
import { PATIENT_1, londonDate, mailTo, pickFreeSlot, signIn } from './support';

test('A client can book a free appointment and gets a confirmation email', async ({ page }) => {
  await signIn(page, PATIENT_1);
  const before = (await mailTo(PATIENT_1)).length;
  const slot = await pickFreeSlot(page, londonDate(10));
  await page.getByTestId('slot-link').first().click();
  await expect(page.getByTestId('book-when')).toContainText(slot.time);
  await page.getByTestId('confirm-booking').click();

  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
  const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: slot.time });
  await expect(row.first().getByTestId('booking-status')).toHaveText('Confirmed');
  await expect.poll(async () => (await mailTo(PATIENT_1)).length, { timeout: 15_000 }).toBeGreaterThan(before);
});
