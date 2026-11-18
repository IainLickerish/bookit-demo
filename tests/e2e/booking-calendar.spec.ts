import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { E2E_START, query, signIn } from './support';

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

test('keeps the confirmation when the booking reaches its start time', async ({ page }) => {
  await signIn(page, 'patient2@patients.example.test');
  await page.goto('/slots?date=2026-10-23');
  const slot = page.getByTestId('slot-link').first();
  const slotId = (await slot.getAttribute('data-slot-id'))!;
  const startsAt = (await slot.getAttribute('data-starts-at'))!;
  await slot.click();
  await page.getByTestId('confirm-booking').click();
  const confirmation = page.getByTestId('booking-confirmation');
  const calendar = confirmation.getByTestId('add-to-calendar');
  await expect(calendar).toBeVisible();
  const href = (await calendar.getAttribute('href'))!;
  // Put this fixture at the fixed clock's current time without advancing the shared clock.
  const placeSlot = (when: string) =>
    query(
      'update slot set starts_at = $2::timestamptz, ends_at = $2::timestamptz + (ends_at - starts_at) where id = $1',
      [slotId, when],
    );
  try {
    await placeSlot(E2E_START);
    await page.reload();
    await expect(confirmation.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(confirmation.getByTestId('add-to-calendar')).toHaveCount(0);
    expect((await page.request.get(href)).status()).toBe(404);
  } finally {
    await placeSlot(startsAt);
  }
});

test('Back keeps the calendar link hidden after cancelling', async ({ page }) => {
  await signIn(page, 'patient1@patients.example.test');
  await page.goto('/slots?date=2026-10-26');
  await page.getByTestId('slot-link').first().click();
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('booking-confirmation').getByTestId('add-to-calendar')).toBeVisible();
  await page.getByTestId('nav-my-bookings').click();
  const booking = page.getByTestId('upcoming-bookings').getByTestId('booking-row');
  await expect(booking.getByTestId('add-to-calendar')).toBeVisible();
  const when = await booking.getByTestId('booking-when').innerText();
  await booking.getByTestId('cancel-booking').click();
  await expect(page.getByTestId('notice')).toHaveText('Booking cancelled.');
  await page.goBack();
  await expect(page).toHaveURL(/\/bookings$/);
  await expect(page.getByTestId('add-to-calendar')).toHaveCount(0);
  const cancelled = page.getByTestId('other-bookings').getByTestId('booking-row').filter({ hasText: when });
  await expect(cancelled.getByTestId('booking-status')).toHaveText('Cancelled');
});

test('Back shows the same moved time as the calendar download', async ({ page }) => {
  await signIn(page, 'patient2@patients.example.test');
  await page.goto('/slots?date=2026-10-28');
  await page.getByTestId('slot-link').first().click();
  const originalWhen = (await page.getByTestId('book-when').innerText()).replace(/ \(\d+ minutes\)$/, '');
  await page.getByTestId('confirm-booking').click();
  const confirmation = page.getByTestId('booking-confirmation');
  await expect(confirmation).toContainText(originalWhen);
  const originalConfirmation = page.url();
  const row = page.getByTestId('booking-row').filter({ hasText: originalWhen });
  await row.getByTestId('reschedule-link').click();
  const choice = page.getByTestId('reschedule-to').first();
  const movedWhen = await choice.innerText();
  expect(movedWhen).not.toBe(originalWhen);
  await choice.click();
  await expect(confirmation.getByTestId('notice')).toHaveText('Booking rescheduled.');
  await expect(confirmation).toContainText(movedWhen);

  await page.goBack();
  await expect(page).toHaveURL(/\/reschedule$/);
  await page.goBack();
  await expect(page).toHaveURL(originalConfirmation);
  const calendar = await downloadCalendar(page, 'booking-confirmation');
  expect(calendar).toContain(`DESCRIPTION:${movedWhen.replaceAll(',', '\\,')}`);
  await expect(confirmation).toContainText(movedWhen);
  await expect(confirmation).not.toContainText(originalWhen);
});

test('a double-click downloads only one calendar file', async ({ page }) => {
  await signIn(page, 'patient1@patients.example.test');
  await page.goto('/slots?date=2026-10-27');
  await page.getByTestId('slot-link').first().click();
  await page.getByTestId('confirm-booking').click();
  const calendar = page.getByTestId('booking-confirmation').getByTestId('add-to-calendar');
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  await Promise.all([page.waitForEvent('download'), calendar.dblclick()]);
  await expect(page.waitForEvent('download', { timeout: 500 })).rejects.toThrow('Timeout');
  expect(downloads).toEqual(['booking.ics']);
});
