import { expect, test, type Page } from '@playwright/test';
import { PATIENT_1, signIn, step } from './support';

async function headerFits(page: Page) {
  const header = page.getByTestId('site-header');
  const name = page.getByTestId('clinic-name');
  await expect(name).toHaveText('Acme Physio');
  await expect(name).toHaveCSS('font-family', /Fraunces/);
  await expect(page.getByTestId('main-navigation')).toHaveCSS('font-family', /Figtree/);
  const viewport = page.viewportSize()!;
  for (const control of [
    name,
    page.getByTestId('nav-book'),
    page.getByTestId('nav-my-bookings'),
    page.getByTestId('sign-out'),
  ]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('Clinic names and headings use local Fraunces, while body text, controls and navigation use local Figtree.', async ({
  page,
}) => {
  await step(page, 'Open sign in and let the local typefaces load', async () => {
    await page.goto('/auth/sign-in');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  });
  await step(page, 'See the clinic name and page title in Fraunces', async () => {
    await expect(page.getByTestId('clinic-name')).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCSS('font-family', /Fraunces/);
    expect(await page.evaluate(() => document.fonts.check('500 28px Fraunces'))).toBe(true);
  });
  await step(page, 'See Figtree on words and controls, served by BookIt', async () => {
    await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);
    await expect(page.getByTestId('sign-in-email')).toHaveCSS('font-family', /Figtree/);
    await expect(page.getByTestId('sign-in-submit')).toHaveCSS('font-family', /Figtree/);
    const fonts = await page.evaluate(() => {
      const faces = [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family);
      const files = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('.woff2'));
      return { faces, files, origin: location.origin };
    });
    expect(fonts.faces).toEqual(expect.arrayContaining(['Fraunces', 'Figtree']));
    for (const family of ['fraunces', 'figtree']) {
      expect(fonts.files.some((url) => new URL(url).pathname.includes(family))).toBe(true);
    }
    for (const url of fonts.files) expect(new URL(url).origin).toBe(fonts.origin);
  });
  await step(page, 'Open password recovery with the same typography', async () => {
    await page.getByTestId('forgot-password-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByTestId('forgot-password-submit')).toHaveCSS('font-family', /Figtree/);
  });
});

test('The shared header keeps the configured clinic name and existing navigation usable without horizontal scrolling on phones and laptops.', async ({
  page,
}) => {
  await step(page, 'Sign in on a small phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_1);
    await headerFits(page);
  });
  await step(page, 'Use Book in the phone header', async () => {
    await page.getByTestId('nav-book').click();
    await expect(page).toHaveURL(/\/slots$/);
    await headerFits(page);
  });
  await step(page, 'Return to My bookings using the phone header', async () => {
    await page.getByTestId('nav-my-bookings').click();
    await expect(page).toHaveURL(/\/bookings$/);
    await headerFits(page);
  });
  await step(page, 'Use the same navigation on a laptop', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await headerFits(page);
    await page.getByTestId('nav-book').click();
    await expect(page).toHaveURL(/\/slots$/);
    await headerFits(page);
    await expect(page.getByTestId('page-content')).toHaveCSS('max-width', '720px');
  });
  await step(page, 'Sign out from the shared header', async () => {
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByTestId('clinic-name')).toHaveText('Acme Physio');
    await expect(page.getByTestId('main-navigation')).toHaveCount(0);
  });
});

test('Shared controls use pine actions, pill buttons and visible keyboard focus against the warm ivory page background.', async ({
  page,
}) => {
  await step(page, 'Open sign in on the warm ivory page', async () => {
    await page.goto('/auth/sign-in');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
    await expect(page.getByTestId('site-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });
  await step(page, 'See a pine pill action and comfortable fields', async () => {
    const button = page.getByTestId('sign-in-submit');
    await expect(button).toHaveCSS('background-color', 'rgb(29, 92, 75)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('border-radius', '999px');
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    const email = page.getByTestId('sign-in-email');
    await expect(email).toHaveCSS('border-color', 'rgb(140, 151, 146)');
    await expect(email).toHaveCSS('border-radius', '12px');
    expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });
  await step(page, 'Tab through the fields to the main action with a visible pine ring', async () => {
    await page.getByTestId('clinic-name').focus();
    for (const id of ['sign-in-email', 'sign-in-password', 'sign-in-submit']) {
      await page.keyboard.press('Tab');
      const control = page.getByTestId(id);
      await expect(control).toBeFocused();
      await expect(control).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
      await expect(control).toHaveCSS('outline-style', 'solid');
      await expect(control).toHaveCSS('outline-width', '3px');
    }
  });
  await step(page, 'Tab onward to the recovery link and open it', async () => {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('forgot-password-link')).toBeFocused();
    await expect(page.getByTestId('forgot-password-link')).toHaveCSS('color', 'rgb(29, 92, 75)');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
  });
});
