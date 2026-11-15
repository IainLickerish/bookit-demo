import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, bookingRow, givePhone, londonDate, showDay, signIn, step } from './support';
import { expectPageToFit, expectTableToScroll, expectWhiteCard, filterStaffDay } from './staff-design-support';

test('Clinic bookings presents filters and results in white cards with a stone table header and labelled status pills', async ({
  page,
}) => {
  const date = londonDate(80);
  let when = '';
  await step(page, 'Book a free time for this staff display check', async () => {
    await signIn(page, PATIENT_2);
    await showDay(page, date);
    await page.getByTestId('slot-link').filter({ hasText: '09:00' }).click();
    when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
    await givePhone(page);
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking confirmed.');
  });
  await step(page, 'Sign in as staff and see the booking in the styled diary', async () => {
    await page.getByTestId('sign-out').click();
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await filterStaffDay(page, date, 'confirmed');
    await expectWhiteCard(page.getByTestId('admin-filters'));
    await expectWhiteCard(page.getByTestId('admin-results'));
    await expect(page.getByRole('heading', { name: 'Clinic bookings', exact: true })).toHaveCSS(
      'font-family',
      /Fraunces/,
    );
    await expect(page.getByTestId('admin-table').locator('thead')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    const row = page
      .getByTestId('admin-booking-row')
      .filter({ has: page.getByRole('cell', { name: when, exact: true }) });
    await expect(row.getByRole('cell', { name: 'Łukasz Wiśniewski', exact: true })).toBeVisible();
    await expect(row.getByTestId('admin-booking-status')).toContainText('Confirmed');
    await expect(row.getByTestId('admin-booking-status')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(row.getByTestId('admin-booking-status')).toHaveCSS('color', 'rgb(29, 92, 75)');
    await expect(page.getByTestId('admin-export')).toHaveAttribute('href', new RegExp(`date=${date}`));
  });
  await step(page, 'Use the table with the keyboard on a phone without moving the whole page sideways', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await expectTableToScroll(page);
  });
  await step(page, 'Enlarge the laptop view to 200% and keep scrolling inside the table', async () => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectTableToScroll(page);
  });
  await step(page, 'Cancel the booking created for this check using the existing client action', async () => {
    await page.getByTestId('sign-out').click();
    await signIn(page, PATIENT_2);
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(page.getByTestId('notice')).toContainText('Booking cancelled.');
  });
  await step(page, 'See the cancelled booking with the stone status pill in the staff diary', async () => {
    await page.getByTestId('sign-out').click();
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await filterStaffDay(page, date, 'cancelled');
    const row = page
      .getByTestId('admin-booking-row')
      .filter({ has: page.getByRole('cell', { name: when, exact: true }) });
    await expect(row.getByTestId('admin-booking-status')).toContainText('Cancelled');
    await expect(row.getByTestId('admin-booking-status')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    await expect(row.getByTestId('admin-booking-status')).toHaveCSS('color', 'rgb(90, 104, 98)');
  });
  await step(page, 'See the existing filter error while the filter card stays available', async () => {
    await page.goto('/admin?status=not-a-status');
    await expect(page.getByTestId('admin-filter-error')).toContainText(
      'Choose a valid practitioner, calendar date and booking status.',
    );
    await expect(page.getByTestId('admin-filter-error')).toHaveAttribute('role', 'alert');
    await expectWhiteCard(page.getByTestId('admin-filters'));
    await expect(page.getByTestId('admin-results')).toHaveCount(0);
  });
});

test('Clinic settings presents its existing form in a white card, with a serif title and styled result messages', async ({
  page,
}) => {
  let zone = '';
  await step(page, 'Open settings as staff and see the existing fields in a white card', async () => {
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await page.getByTestId('admin-settings-link').click();
    await expectWhiteCard(page.getByTestId('admin-settings-form'));
    await expect(page.getByRole('heading', { name: 'Clinic settings', exact: true })).toHaveCSS(
      'font-family',
      /Fraunces/,
    );
    zone = await page.getByTestId('admin-time-zone').inputValue();
    await expect(page.getByTestId('admin-time-zone')).toHaveAttribute('aria-describedby', 'admin-time-zone-hint');
    for (const id of ['admin-clinic-name', 'admin-time-zone', 'admin-late-hours', 'admin-save-settings']) {
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
  });
  await step(page, 'Enter an invalid time zone and see the existing problem message', async () => {
    await page.getByTestId('admin-time-zone').fill('Not/A-Time-Zone');
    await page.getByTestId('admin-save-settings').click();
    await expect(page.getByTestId('admin-settings-error')).toContainText('Enter a clinic name, a valid IANA time zone');
    await expect(page.getByTestId('admin-settings-error')).toHaveCSS('background-color', 'rgb(252, 235, 232)');
    await expectWhiteCard(page.getByTestId('admin-settings-form'));
  });
  await step(page, 'Save the original settings and see the existing success message', async () => {
    await page.getByTestId('admin-time-zone').fill(zone);
    await page.getByTestId('admin-save-settings').click();
    await expect(page.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    await expect(page.getByTestId('admin-settings-saved')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('admin-settings-saved')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(page.getByTestId('admin-time-zone')).toHaveValue(zone);
    await expectWhiteCard(page.getByTestId('admin-settings-form'));
  });
  await step(page, 'Read the form at 200% zoom and use its existing return link', async () => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectPageToFit(page);
    await page.getByRole('link', { name: 'Back to bookings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Clinic bookings', exact: true })).toBeVisible();
  });
});

test('Page-not-found presents its existing return action in a centred white card with a serif title', async ({
  page,
}) => {
  await step(page, 'Open a missing page on a laptop and see the centred fallback card', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await page.goto('/premium-design-missing-page');
    expect(response?.status()).toBe(404);
    const card = page.getByTestId('not-found');
    await expectWhiteCard(card);
    await expect(card).toHaveCSS('max-width', '440px');
    const box = (await card.boundingBox())!;
    const frame = (await page.getByTestId('page-content').boundingBox())!;
    expect(frame.width).toBeGreaterThan(box.width);
    expect(Math.abs(box.x + box.width / 2 - frame.x - frame.width / 2)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toHaveCSS(
      'font-family',
      /Fraunces/,
    );
  });
  await step(page, 'Reach the return action with the keyboard on a phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await expectPageToFit(page);
    await page.getByTestId('clinic-name').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('not-found-home')).toBeFocused();
    await expect(page.getByTestId('not-found-home')).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(page.getByTestId('not-found-home')).toHaveCSS('border-radius', '9999px');
    expect((await page.getByTestId('not-found-home').boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });
  await step(page, 'Use the existing return action and arrive at sign in', async () => {
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sign-in-email')).toBeVisible();
    await expectWhiteCard(page.getByTestId('sign-in-card'));
  });
});
