import { expect, test, type Page } from '@playwright/test';
import { ADMIN, PATIENT_1, signIn, step } from './support';

async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectPineFocus(page: Page) {
  await expect(page.locator(':focus')).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
  await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator(':focus')).toHaveCSS('outline-width', '3px');
}

test('The shared header, staff home and missing-page screen keep useful navigation and home redirects, fit a phone and show pine keyboard focus', async ({
  page,
}) => {
  await step(
    page,
    'On a phone, open the start page and reach sign-in with the clinic name leading the header',
    async () => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.goto('/');
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
      await expect(page.getByTestId('clinic-name')).not.toBeEmpty();
      await expect(page.getByTestId('site-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('clinic-name')).toBeFocused();
      await expectPineFocus(page);
      await expectNoSidewaysScroll(page);
    },
  );

  await step(
    page,
    'Sign in as staff and use the refreshed home card to reach clinic bookings and settings',
    async () => {
      await signIn(page, ADMIN);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clinic administration');
      await expect(page.getByTestId('admin-home')).toHaveText('You are signed in as the clinic admin.');
      await expect(page.getByTestId('admin-home-card')).toHaveCSS('border-radius', '20px');
      await expectNoSidewaysScroll(page);
      await page.getByTestId('home-clinic-bookings').click();
      await expect(page).toHaveURL(/\/admin$/);
      await page.goto('/');
      await page.getByTestId('home-clinic-settings').click();
      await expect(page).toHaveURL(/\/admin\/settings$/);
    },
  );

  await step(
    page,
    'Use the phone header and missing-page link with a keyboard to get back to the staff home',
    async () => {
      await page.goto('/a-page-that-does-not-exist');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
      await expect(page.getByTestId('not-found')).toHaveCSS('border-radius', '20px');
      await expectNoSidewaysScroll(page);
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('clinic-name')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('nav-admin')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('sign-out')).toBeFocused();
      await expectPineFocus(page);
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('not-found-home')).toBeFocused();
      await expectPineFocus(page);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('admin-home-card')).toBeVisible();
    },
  );

  await step(page, 'On a laptop, use the same staff home with motion switched off', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByTestId('home-clinic-bookings')).toHaveCSS('transition-duration', '0s');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '32px');
    await expectNoSidewaysScroll(page);
    await expect(page.getByTestId('home-clinic-bookings')).toHaveCSS('min-height', '48px');
  });

  await step(page, 'Sign out and sign in as a client, whose start page still opens My bookings', async () => {
    await page.getByTestId('sign-out').click();
    await signIn(page, PATIENT_1);
    await page.goto('/');
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByTestId('nav-my-bookings')).toBeVisible();
    await expect(page.getByTestId('nav-book')).toBeVisible();
    await expect(page.getByTestId('nav-admin')).toHaveCount(0);
    await expect(page.getByTestId('clinic-name')).toHaveCSS('font-family', /Fraunces/);
  });
});
