import { expect, test, type Page } from '@playwright/test';
import {
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  pickFreeSlot,
  showDay,
  signIn,
  step,
} from './support';

async function checkColumn(page: Page) {
  const box = (await page.getByTestId('booking-page').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(720);
  expect(Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function checkTimePills(page: Page, testId: string) {
  const choices = page.getByTestId(testId);
  await expect(choices).not.toHaveCount(0);
  for (const choice of await choices.all()) {
    await expect(choice).toHaveCSS('border-radius', '999px');
    await expect(choice).toHaveCSS('font-variant-numeric', 'tabular-nums');
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(choice).toContainText(/\d{2}:\d{2}/);
  }
}

test('Phone booking confirmation uses a centred card and a fixed action bar with reachable details, phone field and return link', async ({
  page,
}) => {
  let when = '';
  await step(page, 'Sign in on a small phone as a client without a phone number', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_2);
  });

  await step(page, 'Choose a free time and read its details in one centred confirmation card', async () => {
    const choice = await pickFreeSlot(page, londonDate(71));
    await page.getByRole('link', { name: new RegExp(`${choice.time}$`) }).click();
    const card = page.getByTestId('booking-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(card).toHaveCSS('border-radius', '20px');
    const box = (await card.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(440);
    expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThanOrEqual(1);
    await expect(card.getByTestId('page-title')).toHaveText('Confirm your booking');
    await expect(card.getByTestId('book-practitioner')).toContainText(PRACTITIONER);
    await expect(card.getByTestId('book-when')).toContainText('(45 minutes)');
    when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
    await expect(page.getByTestId('book-phone')).toHaveValue('');
    expect(await page.getByTestId('book-phone').getAttribute('required')).toBeNull();
    await checkColumn(page);
  });

  await step(page, 'Reach every detail and the return link above the action bar on a short phone', async () => {
    await page.setViewportSize({ width: 320, height: 480 });
    const bar = page.getByTestId('booking-action-bar');
    await expect(bar).toHaveCSS('position', 'fixed');
    await expect(page.getByTestId('confirm-booking')).toHaveCount(1);
    const barBox = (await bar.boundingBox())!;
    expect(Math.abs(barBox.y + barBox.height - 480)).toBeLessThanOrEqual(1);
    for (const id of ['book-practitioner', 'book-when', 'book-phone', 'choose-different-time']) {
      const content = page.getByTestId(id);
      await content.scrollIntoViewIfNeeded();
      const box = (await content.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(barBox.y);
    }
    await expect(page.getByTestId('choose-different-time')).toHaveText('Choose a different time');
    expect(
      await page.getByTestId('confirm-booking').evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }),
    ).toBe(true);
    await checkColumn(page);
  });

  await step(page, 'Confirm from the phone bar and see this booking saved in My bookings', async () => {
    await page.getByTestId('confirm-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
    await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
  });
});

test('Available times use white picker cards and pill choices with even-width figures on desktop and phone', async ({
  page,
}) => {
  const date = londonDate(73);
  await step(page, 'Sign in and choose a day on the desktop time picker', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, PATIENT_2);
    await showDay(page, date);
    await expect(page.getByTestId('page-title')).toHaveText('Book an appointment');
    await expect(page.getByTestId('day-picker')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.getByTestId('day-picker')).toHaveCSS('padding', '24px');
    await expect(page.getByTestId('times-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await checkTimePills(page, 'slot-link');
    await checkColumn(page);
  });

  await step(page, 'Use the existing next-day and previous-day links', async () => {
    const shown = (await page.getByTestId('shown-date').textContent()) ?? '';
    await page.getByTestId('next-day').click();
    await expect(page.getByTestId('shown-date')).not.toHaveText(shown);
    await page.getByTestId('previous-day').click();
    await expect(page.getByTestId('shown-date')).toContainText(shown);
    expect(new URL(page.url()).searchParams.get('date')).toBe(date);
  });

  await step(page, 'Use the same picker and full date-and-time choices on a small phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(page.getByTestId('practitioner-select')).toBeVisible();
    await expect(page.getByTestId('date-input')).toBeVisible();
    await expect(page.getByTestId('show-slots')).toBeVisible();
    await expect(page.getByTestId('shown-date')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    await expect(page.getByTestId('shown-date')).toHaveCSS('border-color', 'rgb(29, 92, 75)');
    await checkTimePills(page, 'slot-link');
    await checkColumn(page);
  });
});

test('Moving a booking uses the date picker and pill choices before saving the chosen time', async ({ page }) => {
  let originalWhen = '';
  let targetWhen = '';
  await step(page, 'Sign in on a phone and book a free time to move', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_3);
    const original = await pickFreeSlot(page, londonDate(75));
    originalWhen = await bookSlot(page, original.id);
  });

  await step(page, 'Open moving and see the existing booking details and move allowance', async () => {
    await bookingRow(page, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
    await expect(page.getByTestId('page-title')).toHaveText('Reschedule your appointment');
    await expect(page.getByTestId('current-when')).toContainText(originalWhen);
    await expect(page.getByTestId('reschedules-remaining')).toContainText('You can reschedule this booking');
    await expect(page.getByTestId('day-picker')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await checkColumn(page);
  });

  await step(page, 'Choose another day and review its pill-shaped free times', async () => {
    await page.getByTestId('date-input').fill(londonDate(76));
    await page.getByTestId('show-slots').click();
    await checkTimePills(page, 'reschedule-to');
    await expect(page.getByTestId('times-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const labels = await page.getByTestId('reschedule-to').allTextContents();
    // Choose the earliest label offered on this one day, independent of DOM order or generated identifiers.
    targetWhen = labels.reduce((earliest, text) => {
      const label = text.replace(/\s+/g, ' ').trim();
      return !earliest || label.localeCompare(earliest) < 0 ? label : earliest;
    }, '');
    expect(targetWhen).not.toBe('');
    await checkColumn(page);
  });

  await step(page, 'Choose that time and see the moved booking saved', async () => {
    await page.getByRole('button', { name: targetWhen, exact: true }).click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    await expect(bookingRow(page, 'upcoming-bookings', targetWhen).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
    await expect(bookingRow(page, 'upcoming-bookings', originalWhen)).toHaveCount(0);
  });
});
