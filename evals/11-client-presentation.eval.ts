import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  PATIENT_2,
  PATIENT_3,
  bookSlot,
  bookingRow,
  londonDate,
  mailTo,
  resetLink,
  showDay,
  signIn,
  step,
} from './support';

async function fitsScreen(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function whiteCard(card: Locator) {
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
}

async function accountCard(page: Page) {
  const card = page.getByTestId('account-card');
  await whiteCard(card);
  const box = (await card.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.width).toBeLessThanOrEqual(440);
  expect(Math.abs(box.x - (width - box.width) / 2)).toBeLessThanOrEqual(1);
  await fitsScreen(page);
}

async function phoneAction(page: Page, barId: string, buttonId: string) {
  const bar = page.getByTestId(barId);
  await expect(bar).toHaveCSS('position', 'fixed');
  const button = page.getByTestId(buttonId);
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await fitsScreen(page);
}

test('Account screens present their existing forms and messages in centred white cards on phones and laptops.', async ({
  page,
}) => {
  await step(page, 'Open sign in on a phone and see its centred card', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/auth/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await accountCard(page);
  });
  await step(page, 'See the existing sign-in error inside the same card', async () => {
    await page.getByTestId('sign-in-email').fill('premium-account@patients.acmephysio.test');
    await page.getByTestId('sign-in-password').fill('not-a-real-account-password');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toContainText('The email address or password is not correct.');
    await accountCard(page);
  });
  const seen = await step(page, 'Request a password link and see the recovery notice in its card', async () => {
    const seen = (await mailTo(PATIENT_2)).map((mail) => mail.ID);
    await page.getByTestId('forgot-password-link').click();
    await page.getByTestId('forgot-password-email').fill(PATIENT_2);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('forgot-password-sent')).toContainText('If an account uses that email address');
    await accountCard(page);
    return seen;
  });
  await step(page, 'Open the new link on a laptop and see both password fields in the card', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto((await resetLink(PATIENT_2, seen)).path);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Repeat the new password', { exact: true })).toBeVisible();
    await accountCard(page);
  });
  await step(
    page,
    'Return to phone size and see the existing mismatch message without changing the password',
    async () => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.getByTestId('reset-password-new').fill('demo-password-not-saved-one');
      await page.getByTestId('reset-password-confirm').fill('demo-password-not-saved-two');
      await page.getByTestId('reset-password-submit').click();
      await expect(page.getByTestId('reset-password-error')).toContainText('The two passwords do not match.');
      await expect(page.getByTestId('reset-password-confirm')).toHaveAttribute(
        'aria-describedby',
        'reset-password-error',
      );
      await expect(page.getByTestId('reset-password-confirm')).toHaveAttribute('aria-invalid', 'true');
      await accountCard(page);
    },
  );
  await step(page, 'Open an unusable link and use the existing way back to recovery', async () => {
    await page.goto('/auth/reset-password/premium-design-unusable');
    await expect(page.getByTestId('reset-password-invalid')).toContainText(
      'This reset link has expired or has already been used.',
    );
    await accountCard(page);
    await page.getByRole('link', { name: 'Request a new link', exact: true }).click();
    await expect(page.getByTestId('forgot-password-email')).toBeVisible();
  });
});

test('On phones, booking controls and confirmation fit the screen with their main action visible above the bottom edge.', async ({
  page,
}) => {
  const date = londonDate(29);
  await step(page, 'Sign in on a phone and open Book', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_2);
    await page.getByTestId('nav-book').click();
    await whiteCard(page.getByTestId('day-filters'));
    await phoneAction(page, 'day-action-bar', 'show-slots');
  });
  const id = await step(page, 'Choose a day and see pill-shaped free times', async () => {
    await showDay(page, date);
    await expect(page.getByTestId('shown-date')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    const choice = page.getByTestId('slot-link').filter({ hasText: '09:00' });
    await expect(choice).toHaveCSS('border-radius', '999px');
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    const id = (await choice.getAttribute('data-slot-id'))!;
    await choice.click();
    return id;
  });
  await step(page, 'Check the selected booking in one centred card with its phone action', async () => {
    await expect(page).toHaveURL(`/book/${id}`);
    const card = page.getByTestId('booking-card');
    await whiteCard(card);
    expect((await card.boundingBox())!.width).toBeLessThanOrEqual(440);
    await expect(page.getByTestId('book-when')).toContainText('09:00');
    await phoneAction(page, 'booking-action-bar', 'confirm-booking');
    await page.getByRole('link', { name: 'Choose a different time' }).scrollIntoViewIfNeeded();
    const back = (await page.getByRole('link', { name: 'Choose a different time' }).boundingBox())!;
    const bar = (await page.getByTestId('booking-action-bar').boundingBox())!;
    expect(back.y + back.height).toBeLessThanOrEqual(bar.y);
  });
  await step(page, 'See the action return to the card on a laptop', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('booking-action-bar')).toHaveCSS('position', 'static');
    await fitsScreen(page);
  });
  await step(page, 'See the existing optional phone error beside its field', async () => {
    await page.getByTestId('book-phone').fill('not-a-phone-number');
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('booking-error')).toContainText(
      'Please enter a valid phone number, or leave it empty.',
    );
    await expect(page.getByTestId('book-phone')).toHaveAttribute('aria-describedby', 'book-phone-error');
    await expect(page.getByTestId('book-phone')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('book-phone').clear();
    await whiteCard(page.getByTestId('booking-card'));
  });
  await step(page, 'Confirm on the phone and see the existing booking result', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await phoneAction(page, 'booking-action-bar', 'confirm-booking');
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking confirmed.');
    await fitsScreen(page);
  });
  await step(page, 'Reopen that time and see its unavailable message in the same card', async () => {
    await page.goto(`/book/${id}`);
    await whiteCard(page.getByTestId('booking-card'));
    await expect(page.getByTestId('slot-taken')).toContainText('This time is no longer available.');
    await expect(page.getByTestId('confirm-booking')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Choose a different time' })).toBeVisible();
    await fitsScreen(page);
  });
});

test('My bookings shows appointments in white cards with clinic-local date tiles, prominent times and written status pills.', async ({
  page,
}) => {
  const date = londonDate(30);
  const original = await step(page, 'Book a new appointment for this check on a phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_3);
    await showDay(page, date);
    const choice = page.getByTestId('slot-link').filter({ hasText: '10:30' });
    const id = (await choice.getAttribute('data-slot-id'))!;
    await expect(choice).toBeVisible();
    return bookSlot(page, id);
  });
  await step(page, 'See its date, time, practitioner and written Confirmed status in a white card', async () => {
    const row = bookingRow(page, 'upcoming-bookings', original);
    await whiteCard(row);
    await expect(row.getByTestId('date-tile-day')).toHaveText(String(Number(date.slice(-2))));
    await expect(row.getByTestId('booking-date-tile')).toHaveAttribute('aria-hidden', 'true');
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
    await expect(row.getByTestId('booking-status')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(row.getByTestId('slot-time')).toContainText('10:30');
    await expect(row.getByTestId('slot-time')).toHaveCSS('font-size', '22px');
    await fitsScreen(page);
  });
  await step(page, 'Open Reschedule and see the same day controls and phone action', async () => {
    await bookingRow(page, 'upcoming-bookings', original).getByTestId('reschedule-link').click();
    await expect(page.getByTestId('current-when')).toContainText(original);
    await whiteCard(page.getByTestId('day-filters'));
    await phoneAction(page, 'day-action-bar', 'show-slots');
  });
  const moved = await step(page, 'Choose another available time using the existing move action', async () => {
    const target = page.getByTestId('reschedule-to').filter({ hasText: '12:00' });
    await expect(target).toBeVisible();
    await expect(target).toHaveCSS('border-radius', '999px');
    const when = (await target.textContent())!.trim();
    await target.click();
    await expect(page.getByTestId('notice')).toContainText('Booking rescheduled.');
    await whiteCard(bookingRow(page, 'upcoming-bookings', when));
    return when;
  });
  await step(page, 'Review the moved card on a laptop', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(bookingRow(page, 'upcoming-bookings', moved).getByTestId('booking-status')).toHaveText('Confirmed');
    await fitsScreen(page);
  });
  await step(page, 'Cancel it and see the written Cancelled status on stone', async () => {
    await bookingRow(page, 'upcoming-bookings', moved).getByTestId('cancel-booking').click();
    const row = bookingRow(page, 'other-bookings', moved);
    await whiteCard(row);
    await expect(row.getByTestId('booking-status')).toHaveText('Cancelled');
    await expect(row.getByTestId('booking-status')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
  });
});
