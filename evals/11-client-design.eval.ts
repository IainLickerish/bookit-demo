import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  PATIENT_2,
  PATIENT_3,
  bookingRow,
  demoPassword,
  givePhone,
  londonDate,
  mailTo,
  resetLink,
  showDay,
  signIn,
  step,
} from './support';

async function expectCard(card: Locator, frame?: Locator): Promise<void> {
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
  if (frame) {
    await expect(card).toHaveCSS('max-width', '440px');
    const cardBox = await card.boundingBox();
    const frameBox = await frame.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(frameBox).not.toBeNull();
    expect(frameBox!.width).toBeGreaterThan(cardBox!.width);
    await expect
      .poll(
        async () => {
          const [cardBounds, frameBounds] = await Promise.all([card.boundingBox(), frame.boundingBox()]);
          if (!cardBounds || !frameBounds) return Infinity;
          return Math.abs(cardBounds.x + cardBounds.width / 2 - (frameBounds.x + frameBounds.width / 2));
        },
        { message: 'the account card is horizontally centred in the shared content frame' },
      )
      .toBeLessThanOrEqual(1);
  }
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectBottomAction(page: Page, id: string): Promise<void> {
  const bar = page.getByTestId(id);
  await expect(bar).toHaveCSS('position', 'fixed');
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBe(await page.evaluate(() => window.innerHeight));
  const button = bar.getByRole('button');
  await expect(button).toBeInViewport();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expectNoSidewaysScroll(page);
}

test('Sign-in and password recovery screens present their forms and existing messages in centred white cards with serif title headers', async ({
  page,
}) => {
  await step(page, 'Open sign in on a phone and see its white card', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/auth/sign-in');
    await expectCard(page.getByTestId('sign-in-card'));
    await expect(page.getByTestId('sign-in-card')).toHaveCSS('max-width', '440px');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCSS('font-family', /Fraunces/);
    await expectNoSidewaysScroll(page);
  });
  const frame = page.getByTestId('page-content');
  await step(page, 'Widen the window and see the sign-in card centred in the content frame', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectCard(page.getByTestId('sign-in-card'), frame);
    await expectNoSidewaysScroll(page);
  });
  await step(page, 'See the existing wrong-password message within the card', async () => {
    await page.getByTestId('sign-in-email').fill(PATIENT_3);
    await page.getByTestId('sign-in-password').fill('incorrect-design-check-password');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toContainText('The email address or password is not correct.');
    await expect(page.getByTestId('sign-in-error')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('sign-in-email')).toHaveAttribute('aria-describedby', 'sign-in-error');
    await expectCard(page.getByTestId('sign-in-card'), frame);
  });
  let path = '';
  await step(page, 'Request a reset link and see the existing neutral reply in the recovery card', async () => {
    const seen = (await mailTo(PATIENT_3)).map((message) => message.ID);
    await page.getByTestId('forgot-password-link').click();
    await expectCard(page.getByTestId('forgot-password-card'), frame);
    await expect(page.getByRole('heading', { name: 'Reset your password', exact: true })).toHaveCSS(
      'font-family',
      /Fraunces/,
    );
    await page.getByTestId('forgot-password-email').fill(PATIENT_3);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('forgot-password-sent')).toContainText('If an account uses that email address');
    await expect(page.getByTestId('forgot-password-sent')).toHaveAttribute('role', 'status');
    await expectCard(page.getByTestId('forgot-password-card'), frame);
    path = (await resetLink(PATIENT_3, seen)).path;
  });
  await step(page, 'Open the private reset link and see the new-password form in one card', async () => {
    await page.goto(path);
    await expectCard(page.getByTestId('reset-password-card'), frame);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCSS('font-family', /Fraunces/);
    await page.getByTestId('reset-password-new').fill(demoPassword());
    await page.getByTestId('reset-password-confirm').fill('different-design-check-password');
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('reset-password-error')).toContainText('The two passwords do not match.');
    await expectCard(page.getByTestId('reset-password-card'), frame);
  });
  await step(page, 'Keep the demonstration password and return to the styled sign-in result', async () => {
    await page.getByTestId('reset-password-new').fill(demoPassword());
    await page.getByTestId('reset-password-confirm').fill(demoPassword());
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('sign-in-notice')).toContainText('Your password has been changed.');
    await expectCard(page.getByTestId('sign-in-card'), frame);
  });
  await step(page, 'Reopen the used link and see its existing refusal in the same card style', async () => {
    await page.goto(path);
    await expectCard(page.getByTestId('reset-password-card'), frame);
    await expect(page.getByTestId('reset-password-invalid')).toContainText(
      'This reset link has expired or has already been used.',
    );
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    await expectCard(page.getByTestId('reset-password-card'));
    await expectNoSidewaysScroll(page);
  });
});

test('Availability and moving screens show bordered day cards and pill time choices within the shared client layout', async ({
  page,
}) => {
  let when = '';
  await step(page, 'Sign in on a phone and choose a day in the availability card', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_2);
    await showDay(page, londonDate(71));
    await expectCard(page.getByTestId('day-picker'));
    await expect(page.getByTestId('shown-date')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    await expect(page.getByTestId('shown-date')).toHaveCSS('border-color', 'rgb(29, 92, 75)');
    await expectBottomAction(page, 'day-action-bar');
  });
  await step(page, 'Choose a pill time and review the booking in its centred white card', async () => {
    const slot = page.getByTestId('slot-link').filter({ hasText: '09:00' });
    await expect(slot).toHaveCSS('border-radius', '9999px');
    await expect(slot).toHaveCSS('font-variant-numeric', 'tabular-nums');
    await slot.click();
    await expectCard(page.getByTestId('booking-card'));
    await expect(page.getByTestId('booking-card')).toHaveCSS('max-width', '440px');
    when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
    await expectBottomAction(page, 'booking-action-bar');
    await givePhone(page);
    await page.getByRole('link', { name: 'Choose a different time' }).scrollIntoViewIfNeeded();
    const back = await page.getByRole('link', { name: 'Choose a different time' }).boundingBox();
    expect(back!.y + back!.height).toBeLessThanOrEqual((await page.getByTestId('booking-action-bar').boundingBox())!.y);
  });
  await step(page, 'Confirm and open the existing move action for this booking', async () => {
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking confirmed.');
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
    await expect(page.getByTestId('current-when')).toContainText(when);
    await expectCard(page.getByTestId('day-picker'));
    await expectBottomAction(page, 'day-action-bar');
  });
  await step(page, 'Choose another day and move directly using a pill time', async () => {
    await showDayOnMove(page, londonDate(72));
    const time = page.getByTestId('reschedule-to').filter({ hasText: '09:00' });
    await expect(time).toHaveCSS('border-radius', '9999px');
    when = ((await time.textContent()) ?? '').trim();
    await time.click();
    await expect(page.getByTestId('notice')).toContainText('Booking rescheduled.');
    await expect(bookingRow(page, 'upcoming-bookings', when)).toBeVisible();
  });
  await step(page, 'Cancel the booking created for this check', async () => {
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking cancelled.');
    await expect(bookingRow(page, 'other-bookings', when).getByTestId('booking-status')).toContainText('Cancelled');
  });
});

async function showDayOnMove(page: Page, date: string): Promise<void> {
  await page.getByTestId('date-input').fill(date);
  await page.getByTestId('show-slots').click();
  await expect(page.getByTestId('date-input')).toHaveValue(date);
}

test('My bookings presents each booking in a white card with a sage date tile and a labelled status pill', async ({
  page,
}) => {
  let when = '';
  await step(page, 'Book a free time for this card check', async () => {
    await signIn(page, PATIENT_2);
    await showDay(page, londonDate(75));
    await page.getByTestId('slot-link').filter({ hasText: '09:00' }).click();
    when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
    await givePhone(page);
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking confirmed.');
  });
  await step(page, 'See the full booking time beside a decorative date tile and Confirmed pill', async () => {
    const card = bookingRow(page, 'upcoming-bookings', when);
    await expectCard(card);
    await expect(card.getByTestId('booking-when')).toContainText(when);
    await expect(card.getByTestId('booking-date-tile')).toHaveAttribute('aria-hidden', 'true');
    await expect(card.getByTestId('booking-date-tile')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(card.getByTestId('booking-status')).toContainText('Confirmed');
    await expect(card.getByTestId('booking-status')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(card.getByTestId('booking-status')).toHaveCSS('color', 'rgb(29, 92, 75)');
  });
  await step(page, 'Read the booking and reach its actions at 200% zoom', async () => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectNoSidewaysScroll(page);
    const card = bookingRow(page, 'upcoming-bookings', when);
    await card.getByTestId('cancel-booking').scrollIntoViewIfNeeded();
    await expect(card.getByTestId('cancel-booking')).toBeInViewport();
    await card.getByTestId('cancel-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking cancelled.');
  });
  await step(page, 'See the cancelled booking with its existing words and a stone status pill', async () => {
    const card = bookingRow(page, 'other-bookings', when);
    await expectCard(card);
    await expect(card.getByTestId('booking-status')).toContainText('Cancelled');
    await expect(card.getByTestId('booking-status')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    await expect(card.getByTestId('booking-status')).toHaveCSS('color', 'rgb(90, 104, 98)');
    await expect(card.getByTestId('cancel-booking')).toHaveCount(0);
    await expect(card.getByTestId('reschedule-link')).toHaveCount(0);
  });
});
