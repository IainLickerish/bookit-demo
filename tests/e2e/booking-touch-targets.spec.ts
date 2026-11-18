import { expect, test, type Locator } from '@playwright/test';
import { query, signIn } from './support';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: 'off' });

function measureTarget(link: Locator) {
  return link.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
}

test('Clients can tap full-size time choices to book and move on a phone', async ({ page }) => {
  await signIn(page, 'patient2@patients.example.test');
  const bookLink = page.getByTestId('nav-book');
  const bookTarget = await measureTarget(bookLink);
  expect.soft(bookTarget.width, 'Book link width').toBeGreaterThanOrEqual(44);
  expect.soft(bookTarget.height, 'Book link height').toBeGreaterThanOrEqual(44);
  await bookLink.tap();

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

test('Clients can tap a one-letter clinic name to return home on a phone', async ({ page }) => {
  const [settings] = await query<{ clinic_name: string }>('select clinic_name from clinic_settings');
  if (!settings) {
    throw new Error('The browser test clinic settings were not seeded.');
  }
  await query('update clinic_settings set clinic_name = $1', ['I']);
  try {
    await page.goto('/auth/sign-in');
    const clinicLink = page.getByTestId('clinic-name');
    await expect(clinicLink).toHaveText('I');
    const clinicTarget = await measureTarget(clinicLink);
    expect.soft(clinicTarget.width, 'clinic name link width').toBeGreaterThanOrEqual(44);
    expect.soft(clinicTarget.height, 'clinic name link height').toBeGreaterThanOrEqual(44);
    await clinicLink.tap();
    await expect(page).toHaveURL('/');
  } finally {
    await query('update clinic_settings set clinic_name = $1', [settings.clinic_name]);
  }
});
