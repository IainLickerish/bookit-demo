import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, PRACTITIONER, bookSlot, londonDate, pickFreeSlot, signIn, step } from './support';

test('Staff filters keep the bookings table inside a labelled keyboard-scrollable area without sideways page scrolling', async ({
  page,
}) => {
  const date = londonDate(90);
  let when = '';
  await step(page, 'Make a client booking for the staff filter review', async () => {
    await signIn(page, PATIENT_2);
    when = await bookSlot(page, (await pickFreeSlot(page, date)).id);
    await page.getByTestId('sign-out').click();
  });

  await step(page, 'Sign in as clinic staff and open Clinic bookings on a desktop', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await expect(page.getByTestId('page-title')).toHaveText('Clinic bookings');
    await expect(page.getByTestId('page-title')).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByTestId('page-title')).toHaveCSS('font-weight', '500');
    const staff = (await page.getByTestId('staff-page').boundingBox())!;
    expect(staff.width).toBeLessThanOrEqual(1120);
    expect(staff.width).toBeGreaterThan(1000);
    await expect(page.getByTestId('admin-filters')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  await step(page, 'Filter by the booked practitioner, date and Confirmed status', async () => {
    await page.getByTestId('admin-practitioner').selectOption({ label: PRACTITIONER });
    await page.getByTestId('admin-date').fill(date);
    await page.getByTestId('admin-status').selectOption('confirmed');
    await page.getByTestId('admin-filter').click();
    const row = page
      .getByTestId('admin-booking-row')
      .filter({ has: page.getByRole('cell', { name: when, exact: true }) });
    await expect(row.getByRole('cell', { name: PRACTITIONER, exact: true })).toBeVisible();
    await expect(row.getByTestId('admin-booking-status')).toHaveText('Confirmed');
    await expect(row.getByTestId('admin-booking-status')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(page.getByTestId('admin-table-head')).toHaveCSS('background-color', 'rgb(241, 238, 232)');
    const exportUrl = new URL((await page.getByTestId('admin-export').getAttribute('href'))!, page.url());
    expect(exportUrl.searchParams.get('date')).toBe(date);
    expect(exportUrl.searchParams.get('status')).toBe('confirmed');
    expect(exportUrl.searchParams.get('practitionerId')).toBe(new URL(page.url()).searchParams.get('practitionerId'));
  });

  await step(page, 'Tab into the table on a narrow screen and scroll it with the keyboard', async () => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(page.url());
    const region = page.getByRole('region', { name: 'Clinic bookings in Europe/London' });
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region).toHaveCSS('overflow-x', 'auto');
    const controls = await page.locator('a, button, input:not([type="hidden"]), select, [tabindex="0"]').count();
    // Native date fields can have separate day, month and year tab stops.
    for (let tabs = 0; tabs <= controls * 4; tabs++) {
      await page.keyboard.press('Tab');
      if (await region.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(region).toBeFocused();
    await expect(region).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(region).toHaveCSS('outline-style', 'solid');
    await expect(region).toHaveCSS('outline-width', '2px');
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const before = await region.evaluate((element) => element.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  await step(page, 'Keep the filtered table within the page on a phone and at 200% zoom', async () => {
    for (const width of [320, 600]) {
      await page.setViewportSize({ width, height: 1200 });
      await page.evaluate(
        (zoom) => {
          document.documentElement.style.zoom = zoom;
        },
        width === 600 ? '2' : '1',
      );
      const region = page.getByTestId('admin-table-scroll');
      const box = (await region.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await expect(page.getByTestId('admin-date')).toHaveValue(date);
    await expect(page.getByTestId('admin-status')).toHaveValue('confirmed');
  });
});
