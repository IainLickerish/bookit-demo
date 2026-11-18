import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support';

test.use({ trace: 'off', viewport: { width: 390, height: 844 } });

async function downloadCalendar(page: Page, area: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(area).getByRole('link', { name: 'Add to calendar' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('booking.ics');
  return readFile(await download.path(), 'utf8');
}

test('downloads the confirmed booking from the confirmation and My bookings', async ({ browser, page }) => {
  await signIn(page, 'patient1@patients.example.test');
  await page.goto('/slots?date=2026-10-22');
  await page.getByTestId('slot-link').first().click();
  const when = (await page.getByTestId('book-when').innerText()).replace(/ \(\d+ minutes\)$/, '');
  await page.getByTestId('confirm-booking').click();

  const confirmation = page.getByTestId('booking-confirmation');
  await expect(confirmation.getByTestId('notice')).toHaveText('Booking confirmed.');
  await expect(confirmation).toContainText(when);
  const bookedCalendar = await downloadCalendar(page, 'booking-confirmation');
  expect(bookedCalendar).toContain('BEGIN:VEVENT\r\n');
  expect(bookedCalendar).toContain(`DESCRIPTION:${when.replaceAll(',', '\\,')}`);

  await page.getByTestId('nav-my-bookings').click();
  await expect(confirmation).toHaveCount(0);
  expect(await downloadCalendar(page, 'upcoming-bookings')).toBe(bookedCalendar);

  await page.getByTestId('reschedule-link').click();
  const choice = page.getByTestId('reschedule-to').first();
  const movedWhen = await choice.innerText();
  await choice.click();
  await expect(confirmation.getByTestId('notice')).toHaveText('Booking rescheduled.');
  await expect(confirmation).toContainText(movedWhen);
  const movedCalendar = await downloadCalendar(page, 'booking-confirmation');
  expect(movedCalendar).toContain(`DESCRIPTION:${movedWhen.replaceAll(',', '\\,')}`);
  expect(movedCalendar).not.toBe(bookedCalendar);

  await page.getByTestId('nav-my-bookings').click();
  await expect(confirmation).toHaveCount(0);
  expect(await downloadCalendar(page, 'upcoming-bookings')).toBe(movedCalendar);
  const href = (await page.getByTestId('add-to-calendar').getAttribute('href'))!;
  const other = await browser.newPage();
  try {
    const signedOut = await other.request.get(href, { maxRedirects: 0 });
    expect(signedOut.status()).toBe(307);
    expect(signedOut.headers().location).toBe('/auth/sign-in');

    await signIn(other, 'patient2@patients.example.test');
    expect((await other.request.get(href)).status()).toBe(404);
    const bookingId = href.split('/')[2]!;
    await other.goto(`/bookings?booking=${bookingId}&notice=booked`);
    await expect(other.getByTestId('booking-confirmation')).toHaveCount(0);
  } finally {
    await other.close();
  }

  await page.getByTestId('cancel-booking').click();
  const cancelled = page.getByTestId('other-bookings').getByTestId('booking-row');
  await expect(cancelled.getByTestId('booking-status')).toHaveText('Cancelled');
  await expect(cancelled.getByTestId('add-to-calendar')).toHaveCount(0);
  expect((await page.request.get(href)).status()).toBe(404);
});
