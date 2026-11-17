import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { formatSlot } from '../../src/lib/time';

/** A real booking and move, checking the saved file and both calendar service links. */
export async function calendarJourney(
  page: Page,
  url: string,
  clinicName: string,
  practitioner: string,
  minutes: number,
  dates = ['2026-11-03', '2026-11-04'],
): Promise<void> {
  await page.goto(`${url}/slots?date=${dates[0]}`);
  const slot = page.getByTestId('slot-link').first();
  const startsAt = (await slot.getAttribute('data-starts-at'))!;
  await slot.click();
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
  const bookingId = new URL(page.url()).searchParams.get('booking');
  expect(bookingId).toBeTruthy();

  async function checkOptions(container: Locator, start: string) {
    const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
    await container.getByTestId('add-to-calendar').locator('summary').click();
    const google = new URL((await container.getByTestId('calendar-google').getAttribute('href'))!);
    const compact = (instant: string) => instant.replace(/[-:]/g, '').replace('.000', '');
    expect(google.searchParams.get('text')).toBe(`${clinicName} with ${practitioner}`);
    expect(google.searchParams.get('dates')).toBe(`${compact(start)}/${compact(end)}`);
    expect(google.searchParams.get('ctz')).toBe('Europe/London');
    const outlook = new URL((await container.getByTestId('calendar-outlook').getAttribute('href'))!);
    expect(outlook.searchParams.get('subject')).toBe(`${clinicName} with ${practitioner}`);
    expect(outlook.searchParams.get('startdt')).toBe(start);
    expect(outlook.searchParams.get('enddt')).toBe(end);
    const pending = page.waitForEvent('download');
    await container.getByTestId('calendar-download').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('booking.ics');
    const file = readFileSync((await download.path())!, 'utf8').replace(/\r\n /g, '');
    expect(file).toContain(`SUMMARY:${clinicName} with ${practitioner}\r\n`);
    expect(file).toContain(`DTSTART:${compact(start)}\r\n`);
    expect(file).toContain(`DTEND:${compact(end)}\r\n`);
    expect(file).toContain(`${minutes} minutes`);
    expect(file).toContain(formatSlot(new Date(start), 'Europe/London').replace(/,/g, '\\,'));
    await container.getByTestId('add-to-calendar').locator('summary').click();
  }

  const confirmation = page.getByTestId('booking-confirmation');
  await expect(confirmation).toContainText(clinicName);
  await expect(confirmation).toContainText(practitioner);
  await expect(confirmation).toContainText(`${minutes} minutes`);
  await checkOptions(confirmation, startsAt);
  await page.goto(`${url}/bookings`);
  const row = page.locator(`[data-booking-id="${bookingId}"]`);
  await checkOptions(row, startsAt);
  await row.getByTestId('reschedule-link').click();
  await page.goto(`${url}/bookings/${bookingId}/reschedule?date=${dates[1]}`);
  const target = page.getByTestId('reschedule-to').first();
  const movedStart = (await target.getAttribute('data-starts-at'))!;
  await target.click();
  await expect(page.getByTestId('notice')).toHaveText('Booking rescheduled.');
  await checkOptions(confirmation, movedStart);
  await page.goto(`${url}/bookings`);
  await checkOptions(row, movedStart);
  const rows = page.getByTestId('upcoming-bookings').getByTestId('booking-row');
  for (const upcoming of await rows.all()) {
    await expect(upcoming.getByTestId('add-to-calendar')).toBeVisible();
  }
  await expect(page.getByTestId('other-bookings').getByTestId('add-to-calendar')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
