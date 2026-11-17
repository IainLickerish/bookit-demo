import { expect, test } from '@playwright/test';
import { query, signIn } from './support';

test('Empty, taken-time and move-limit layouts retain their messages and fit enlarged content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page, 'patient2@patients.example.test');
  await page.getByTestId('nav-book').click();
  await page.getByTestId('practitioner-select').selectOption({ label: 'Sam Sports' });
  await page.getByTestId('date-input').fill('2026-12-06');
  await page.getByTestId('show-slots').click();
  await expect(page.getByTestId('times-card').getByTestId('no-slots')).toContainText(
    'No free times on this day. Try another day.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTestId('practitioner-select').selectOption({ label: 'Pat Physio' });
  await page.getByTestId('date-input').fill('2026-12-07');
  await page.getByTestId('show-slots').click();
  const choice = page.getByRole('link', { name: /09:00$/ });
  const bookingPath = (await choice.getAttribute('href'))!;
  await choice.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId('booking-action-bar')).toHaveCSS('position', 'static');
  const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
  const bookingId = (await row.getAttribute('data-booking-id'))!;
  const movePath = (await row.getByTestId('reschedule-link').getAttribute('href'))!;
  // Set up the limit state only for the booking this test just created in its disposable database.
  await query('update booking set reschedule_count = 3 where id = $1', [bookingId]);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(movePath);
  await expect(page.getByTestId('reschedule-limit')).toContainText(
    'This booking has been rescheduled as many times as the clinic allows. Please contact the clinic.',
  );
  await expect(page.getByTestId('reschedule-to')).toHaveCount(0);
  await expect(page.getByTestId('back-to-my-bookings')).toBeVisible();

  await page.goto(bookingPath);
  await expect(page.getByTestId('booking-card').getByTestId('slot-taken')).toContainText(
    'This time is no longer available.',
  );
  await expect(page.getByTestId('booking-action-bar')).toHaveCount(0);
  await expect(page.getByTestId('confirm-booking')).toHaveCount(0);
  await expect(page.getByTestId('choose-different-time')).toBeVisible();

  for (const path of ['/slots', bookingPath, movePath]) {
    await page.goto(path);
    await page.setViewportSize({ width: 600, height: 1200 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    for (const control of await page
      .locator('main input:not([type="hidden"]), main select, main button, main a')
      .all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(600);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('unavailable-enlarged.png') });
});
