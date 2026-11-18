import { expect, test } from '@playwright/test';
import { signIn } from './support';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: 'off' });

test('Clients can tap full-size time choices to book and move on a phone', async ({ page }) => {
  await signIn(page, 'patient2@patients.example.test');
  await page.getByTestId('nav-book').tap();

  const bookingChoices = page.getByTestId('slot-link');
  const originalTime = await bookingChoices.first().innerText();
  const bookingHeights = await bookingChoices.evaluateAll((choices) =>
    choices.map((choice) => choice.getBoundingClientRect().height),
  );
  await bookingChoices.first().tap();
  await expect(page.getByTestId('book-when')).toContainText(originalTime);
  await page.getByTestId('confirm-booking').tap();

  const booking = page.getByTestId('booking-row');
  await expect(booking.getByTestId('booking-when')).toHaveText(originalTime);
  const bookingId = await booking.getAttribute('data-booking-id');
  await booking.getByTestId('reschedule-link').tap();
  await expect(page.getByTestId('current-when')).toHaveText(originalTime);

  const moveChoices = page.getByTestId('reschedule-to');
  const newTime = await moveChoices.first().innerText();
  const moveHeights = await moveChoices.evaluateAll((choices) =>
    choices.map((choice) => choice.getBoundingClientRect().height),
  );
  expect(newTime).not.toBe(originalTime);
  await moveChoices.first().tap();
  await expect(booking.getByTestId('booking-when')).toHaveText(newTime);
  expect(await booking.getAttribute('data-booking-id')).toBe(bookingId);
  await expect(booking.getByTestId('booking-status')).toHaveText('Confirmed');

  expect.soft(Math.min(...bookingHeights), 'shortest booking time choice').toBeGreaterThanOrEqual(48);
  expect.soft(Math.min(...moveHeights), 'shortest rescheduling time choice').toBeGreaterThanOrEqual(48);
});
