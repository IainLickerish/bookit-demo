import { expect, test, type Locator, type Page } from '@playwright/test';
import { PATIENT_2, PRACTITIONER, bookSlot, bookingRow, londonDate, pickFreeSlot, signIn, step } from './support';

async function checkCard(card: Locator, date: string) {
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-color', 'rgb(230, 225, 216)');
  await expect(card).toHaveCSS('border-width', '1px');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
  await expect(card.getByTestId('booking-date-tile')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
  await expect(card.getByTestId('booking-date-tile')).toHaveAttribute('aria-hidden', 'true');
  await expect(card.getByTestId('booking-date-day')).toHaveText(String(Number(date.slice(8))));
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'Europe/London' }).format(
    new Date(`${date}T12:00:00Z`),
  );
  await expect(card.getByTestId('booking-date-month')).toHaveText(month);
  await expect(card.getByTestId('booking-when')).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await expect(card.getByTestId('booking-practitioner')).toContainText(`With ${PRACTITIONER}`);
}

async function checkColumn(page: Page) {
  const box = (await page.getByTestId('my-bookings-page').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(720);
  expect(Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('Upcoming booking cards show sage date tiles and Confirmed pills, with phone wrapping and pine keyboard focus', async ({
  page,
}) => {
  const date = londonDate(85);
  let when = '';
  await step(page, 'Sign in and make a booking to review on the desktop', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, PATIENT_2);
    const slot = await pickFreeSlot(page, date);
    when = await bookSlot(page, slot.id);
  });

  await step(page, 'Read the full booking details in a white card with a date tile and Confirmed pill', async () => {
    await expect(page.getByRole('heading', { name: 'My bookings', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming', exact: true })).toBeVisible();
    const card = bookingRow(page, 'upcoming-bookings', when);
    await checkCard(card, date);
    await expect(card.getByTestId('booking-when')).toContainText(when);
    const status = card.getByTestId('booking-status');
    await expect(status).toHaveText('Confirmed');
    await expect(status).toHaveCSS('border-radius', '999px');
    await expect(status).toHaveCSS('color', 'rgb(29, 92, 75)');
    await expect(status).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await checkColumn(page);
  });

  await step(page, 'Read the same card and reach its actions on a 320px phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    const card = bookingRow(page, 'upcoming-bookings', when);
    await card.scrollIntoViewIfNeeded();
    await checkCard(card, date);
    await checkColumn(page);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(20);
    expect(box.x + box.width).toBeLessThanOrEqual(300);
    for (const id of ['reschedule-link', 'cancel-booking']) {
      const action = card.getByTestId(id);
      await expect(action).toBeVisible();
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  await step(page, 'Tab to Reschedule and Cancel and see a pine focus ring on each action', async () => {
    await page.goto('/bookings');
    const card = bookingRow(page, 'upcoming-bookings', when);
    const reschedule = card.getByTestId('reschedule-link');
    const controls = await page.locator('a, button').count();
    for (let tabs = 0; tabs <= controls; tabs++) {
      await page.keyboard.press('Tab');
      if (await reschedule.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(reschedule).toBeFocused();
    await expect(reschedule).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(reschedule).toHaveCSS('outline-style', 'solid');
    await expect(reschedule).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Tab');
    const cancel = card.getByTestId('cancel-booking');
    await expect(cancel).toBeFocused();
    await expect(cancel).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(cancel).toHaveCSS('outline-style', 'solid');
    await expect(cancel).toHaveCSS('outline-width', '2px');
  });

  await step(page, 'Enlarge the page to 200% and keep the booking details and actions within the screen', async () => {
    await page.setViewportSize({ width: 600, height: 1200 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    const card = bookingRow(page, 'upcoming-bookings', when);
    await expect(card.getByTestId('booking-when')).toContainText(when);
    for (const action of await card.locator('a, button').all()) {
      const box = (await action.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(600);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('Cancelling a booking changes its card from a pine Confirmed pill on sage to a muted Cancelled pill on stone', async ({
  page,
}) => {
  const date = londonDate(86);
  let when = '';
  await step(page, 'Sign in on a phone and make a booking outside the late cancellation window', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_2);
    const slot = await pickFreeSlot(page, date);
    when = await bookSlot(page, slot.id);
  });

  await step(page, 'See the new booking with its Confirmed status pill', async () => {
    const card = bookingRow(page, 'upcoming-bookings', when);
    await checkCard(card, date);
    const status = card.getByTestId('booking-status');
    await expect(status).toHaveText('Confirmed');
    await expect(status).toHaveCSS('color', 'rgb(29, 92, 75)');
    await expect(status).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(status).toHaveCSS('border-radius', '999px');
  });

  await step(page, 'Cancel this booking using its existing action', async () => {
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
    await expect(page.getByTestId('notice')).toContainText('Booking cancelled');
    await expect(bookingRow(page, 'upcoming-bookings', when)).toHaveCount(0);
  });

  await step(page, 'Find the same card in Past and cancelled with a muted status pill on stone', async () => {
    await expect(page.getByRole('heading', { name: 'Past and cancelled', exact: true })).toBeVisible();
    const card = bookingRow(page, 'other-bookings', when);
    await card.scrollIntoViewIfNeeded();
    await checkCard(card, date);
    await expect(card.getByTestId('booking-when')).toContainText(when);
    const status = card.getByTestId('booking-status');
    await expect(status).toHaveText('Cancelled');
    await expect(status).toHaveCSS('color', 'rgb(90, 104, 98)');
    await expect(status).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    await expect(status).toHaveCSS('border-radius', '999px');
    await expect(card.getByTestId('reschedule-link')).toHaveCount(0);
    await expect(card.getByTestId('cancel-booking')).toHaveCount(0);
    await checkColumn(page);
  });
});
