import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, PATIENT_3, PRACTITIONER, bookSlot, londonDate, showDay, signIn, step } from './support';

async function fitsScreen(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function whiteCard(card: Locator) {
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
}

async function pineFocus(control: Locator) {
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
  await expect(control).toHaveCSS('outline-width', '3px');
  await expect(control).toHaveCSS('outline-style', 'solid');
}

test('Clinic bookings keeps its table inside a keyboard scroll area without making the page scroll sideways.', async ({
  page,
}) => {
  const date = londonDate(37);
  const when = await step(page, 'Book an appointment for this table check', async () => {
    await signIn(page, PATIENT_3);
    await showDay(page, date);
    const choice = page.getByTestId('slot-link').filter({ hasText: '09:45' });
    await expect(choice).toBeVisible();
    return bookSlot(page, (await choice.getAttribute('data-slot-id'))!);
  });
  await step(page, 'Sign in as staff and filter to the appointment just booked', async () => {
    await page.getByTestId('sign-out').click();
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await page.getByTestId('admin-practitioner').selectOption({ label: PRACTITIONER });
    await page.getByTestId('admin-date').fill(date);
    await page.getByTestId('admin-status').selectOption('confirmed');
    await page.getByTestId('admin-filter').click();
    const row = page
      .getByTestId('admin-booking-row')
      .filter({ has: page.getByRole('cell', { name: when, exact: true }) });
    await expect(row.getByRole('cell', { name: 'Siobhán Ó Briain', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Confirmed', exact: true })).toBeVisible();
    await whiteCard(page.getByTestId('admin-filters'));
    await whiteCard(page.getByTestId('admin-table-card'));
  });
  await step(page, 'Use the labelled table area on a laptop with a visible keyboard focus ring', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const area = page.getByRole('region', { name: 'Clinic bookings', exact: true });
    await expect(area).toHaveCSS('overflow-x', 'auto');
    await page.getByTestId('admin-export').focus();
    await page.keyboard.press('Tab');
    await pineFocus(area);
    await fitsScreen(page);
  });
  await step(
    page,
    'Narrow the view and scroll the table using the keyboard without moving the page sideways',
    async () => {
      await page.setViewportSize({ width: 640, height: 800 });
      const area = page.getByTestId('admin-table-scroll');
      expect(await area.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await page.getByTestId('admin-export').focus();
      await page.keyboard.press('Tab');
      await pineFocus(area);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => area.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      await fitsScreen(page);
    },
  );
  await step(page, 'Filter to cancelled appointments and see the existing empty message', async () => {
    await page.getByTestId('admin-status').selectOption('cancelled');
    await page.getByTestId('admin-filter').click();
    await expect(page.getByTestId('admin-empty')).toContainText('No bookings match these filters.');
    await whiteCard(page.getByTestId('admin-table-card'));
    await fitsScreen(page);
  });
  await step(page, 'See the existing filter error for an invalid selection', async () => {
    await page.goto(`/admin?date=${date}&status=not-a-status`);
    await expect(page.getByTestId('admin-filter-error')).toContainText(
      'Choose a valid practitioner, calendar date and booking status.',
    );
    await whiteCard(page.getByTestId('admin-filters'));
    await fitsScreen(page);
  });
  await step(page, 'Clear the selection using the existing filter action', async () => {
    await page.getByTestId('admin-clear-filters').click();
    await expect(page.getByTestId('admin-date')).toHaveValue('');
    await expect(page.getByTestId('admin-status')).toHaveValue('');
    await expect(page.getByTestId('admin-practitioner')).toHaveValue('');
    await fitsScreen(page);
  });
});

test('Clinic settings presents its existing fields, notices and actions in a white card with visible keyboard focus.', async ({
  page,
}) => {
  const card = page.getByTestId('admin-settings-card');
  const form = card.getByTestId('admin-settings-form');
  const before = await step(page, 'Open clinic settings on a laptop', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, ADMIN);
    await page.getByTestId('nav-admin').click();
    await page.getByTestId('admin-settings-link').click();
    await whiteCard(card);
    await expect(form).toBeVisible();
    await expect(form).toHaveCSS('box-shadow', 'none');
    await expect(form).toHaveCSS('border-radius', '0px');
    await expect(form.getByTestId('admin-time-zone')).toHaveAttribute('aria-describedby', 'time-zone-hint');
    return {
      name: await form.getByTestId('admin-clinic-name').inputValue(),
      zone: await form.getByTestId('admin-time-zone').inputValue(),
      hours: await form.getByTestId('admin-late-hours').inputValue(),
      contact: await form.getByTestId('admin-include-contact').isChecked(),
    };
  });
  await step(page, 'Tab through the existing settings fields and save button', async () => {
    await page.getByTestId('admin-back-to-bookings').focus();
    for (const id of [
      'admin-clinic-name',
      'admin-time-zone',
      'admin-late-hours',
      'admin-include-contact',
      'admin-save-settings',
    ]) {
      await page.keyboard.press('Tab');
      await pineFocus(form.getByTestId(id));
    }
  });
  await step(page, 'See the existing error after entering an invalid time zone', async () => {
    await form.getByTestId('admin-time-zone').fill('Invalid/Clinic');
    await form.getByTestId('admin-save-settings').click();
    await expect(card.getByTestId('admin-settings-error')).toContainText('Enter a clinic name, a valid IANA time zone');
    await expect(card.getByTestId('admin-settings-error')).toHaveCSS('background-color', 'rgb(252, 235, 232)');
    await whiteCard(card);
    await expect(form).toBeVisible();
    await expect(form).toHaveCSS('box-shadow', 'none');
    await expect(form).toHaveCSS('border-radius', '0px');
  });
  await step(page, 'Save the original values in the phone layout and see the existing confirmation', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await form.getByTestId('admin-clinic-name').fill(before.name);
    await form.getByTestId('admin-time-zone').fill(before.zone);
    await form.getByTestId('admin-late-hours').fill(before.hours);
    await form.getByTestId('admin-include-contact').setChecked(before.contact);
    await form.getByTestId('admin-save-settings').click();
    await expect(card.getByTestId('admin-settings-saved')).toContainText('Clinic settings saved.');
    await expect(card.getByTestId('admin-settings-saved')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await expect(form.getByTestId('admin-clinic-name')).toHaveValue(before.name);
    await expect(form.getByTestId('admin-time-zone')).toHaveValue(before.zone);
    await expect(form.getByTestId('admin-late-hours')).toHaveValue(before.hours);
    expect(await form.getByTestId('admin-include-contact').isChecked()).toBe(before.contact);
    await whiteCard(card);
    await expect(form).toBeVisible();
    await expect(form).toHaveCSS('box-shadow', 'none');
    await expect(form).toHaveCSS('border-radius', '0px');
    await fitsScreen(page);
  });
  await step(page, 'Return to clinic bookings with the existing back link', async () => {
    await page.getByTestId('admin-back-to-bookings').click();
    await expect(page.getByRole('heading', { name: 'Clinic bookings', exact: true })).toBeVisible();
    await fitsScreen(page);
  });
});

test('Missing pages offer the existing return action inside a white card with a serif title and pine button.', async ({
  page,
}) => {
  await step(page, 'Open a missing page on a phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    const response = await page.goto('/premium-design-missing-page');
    expect(response?.status()).toBe(404);
    await whiteCard(page.getByTestId('not-found'));
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByTestId('not-found-start')).toHaveText('Go to the start page');
    await expect(page.getByTestId('not-found-start')).toHaveCSS('background-color', 'rgb(29, 92, 75)');
    expect((await page.getByTestId('not-found-start').boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await fitsScreen(page);
  });
  await step(page, 'Reach the existing recovery action with the keyboard', async () => {
    await page.getByTestId('clinic-name').focus();
    await page.keyboard.press('Tab');
    await pineFocus(page.getByTestId('not-found-start'));
  });
  await step(page, 'Use the recovery action and return to sign-in', async () => {
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  });
  await step(page, 'See the same missing-page presentation on a laptop', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/premium-design-missing-page');
    await whiteCard(page.getByTestId('not-found'));
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCSS('font-size', '32px');
    await expect(page.getByTestId('clinic-name')).toBeVisible();
    await fitsScreen(page);
  });
});
