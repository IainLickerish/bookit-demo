import { expect, test } from '@playwright/test';
import { PATIENT_2, PATIENT_3, bookSlot, bookingRow, londonDate, showDay, signIn, slotOffered, step } from './support';

// The factory provides one clinic. The repository's tenant browser tests cover both clinics.
test('In both clinics, accepted late cancellations show “Cancelled (late)” after refreshing My bookings, and the freed time is available to another client.', async ({
  page,
  browser,
}) => {
  const date = londonDate(0);
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_3);
  });

  const { slotId, when } = await step(
    page,
    'Book a free session this afternoon, inside the late-cancellation window',
    async () => {
      await showDay(page, date);
      const slot = page.getByTestId('slot-link').filter({ hasText: /, 15:45$/ });
      await expect(slot).toBeVisible();
      const slotId = (await slot.getAttribute('data-slot-id'))!;
      const when = await bookSlot(page, slotId);
      await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
      return { slotId, when };
    },
  );

  await step(page, 'Cancel the session and see the late-cancellation message', async () => {
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=cancelled_late$/);
    await expect(page.getByTestId('notice')).toContainText('cancelled');
  });

  await step(page, 'Refresh My bookings and see that the session is saved as Cancelled (late)', async () => {
    await page.reload();
    await expect(bookingRow(page, 'other-bookings', when).getByTestId('booking-status')).toHaveText('Cancelled (late)');
    await expect(bookingRow(page, 'upcoming-bookings', when)).toHaveCount(0);
  });

  const other = await (await browser.newContext()).newPage();
  try {
    await step(other, 'Sign in as another client and find the freed time', async () => {
      await signIn(other, PATIENT_2);
      expect(await slotOffered(other, date, slotId), 'the cancelled time is available to another client').toBe(true);
    });

    await step(other, 'Book the freed time and see it confirmed in My bookings', async () => {
      await bookSlot(other, slotId);
      await expect(bookingRow(other, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
    });
  } finally {
    await other.context().close();
  }
});
