import { expect, test } from '@playwright/test';
import { PATIENT_3, PRACTITIONER, londonDate, pickFreeSlot, signIn, step } from './support';

test('Rapidly confirming twice shows Booking confirmed and one matching confirmed booking without an unavailable error', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_3);
  });
  const when = await step(page, 'Choose a free session and check its details', async () => {
    const slot = await pickFreeSlot(page, londonDate(24));
    await page.getByTestId('slot-link').filter({ hasText: slot.time }).click();
    await expect(page.getByTestId('book-practitioner')).toHaveText(PRACTITIONER);
    return ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  });
  await step(page, 'Press Confirm booking twice in quick succession', async () => {
    let submissions = 0;
    const bothSubmitted = new Promise<void>((resolve) => {
      page.on('response', (response) => {
        if (response.request().method() === 'POST' && ++submissions === 2) resolve();
      });
    });
    // Dispatch both clicks together so navigation cannot remove the form between them.
    await page.getByTestId('confirm-booking').evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await bothSubmitted;
    await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
    await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(page.getByTestId('booking-error')).toHaveCount(0);
    await expect(page.getByTestId('slot-taken')).toHaveCount(0);
  });
  await step(page, 'Reload My bookings and see exactly one matching confirmed session', async () => {
    await page.reload();
    const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(PRACTITIONER);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  });
});
