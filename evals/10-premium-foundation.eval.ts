import { expect, test, type Page } from '@playwright/test';
import { ADMIN, PATIENT_1, signIn, step } from './support';

async function expectFrameToFit(page: Page, maxWidth: number, gutter: number): Promise<void> {
  const frame = page.getByTestId('page-content');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveCSS('max-width', `${maxWidth}px`);
  await expect(frame).toHaveCSS('padding-left', `${gutter}px`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of [
    page.getByTestId('clinic-name'),
    ...(await page.getByRole('navigation').getByRole('link').all()),
    page.getByTestId('sign-out'),
  ]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
}

test('Shared pages use ivory backgrounds, a white clinic header, Fraunces titles and Figtree text served locally by BookIt', async ({
  page,
}) => {
  const fonts: { url: string; status: number }[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'font') fonts.push({ url: response.url(), status: response.status() });
  });
  await step(page, 'Open sign in on a warm ivory page', async () => {
    await page.goto('/auth/sign-in');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
    await expect(page.getByTestId('site-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });
  await step(page, 'See the clinic name and page title in the display serif', async () => {
    await expect(page.getByTestId('clinic-name')).toContainText('Acme Physio');
    await expect(page.getByTestId('clinic-name')).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCSS('font-weight', '500');
  });
  await step(page, 'Read Figtree text with both fonts supplied by this BookIt copy', async () => {
    await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('500 28px Fraunces', 'Acme Physio');
      await document.fonts.load('400 16px Figtree', 'Zoë Łukasz Niamh');
      return Array.from(document.fonts)
        .filter((font) => font.status === 'loaded')
        .map((font) => font.family);
    });
    expect(loaded).toEqual(expect.arrayContaining(['Fraunces', 'Figtree']));
    expect(fonts.some((font) => font.url.includes('fraunces'))).toBe(true);
    expect(fonts.some((font) => font.url.includes('figtree-latin-ext'))).toBe(true);
    for (const font of fonts) {
      expect(new URL(font.url).origin).toBe(new URL(page.url()).origin);
      expect(font.status).toBe(200);
    }
  });
});

test('Shared controls have pine keyboard focus, pill buttons and rounded fields at least 48px tall', async ({
  page,
}) => {
  await step(page, 'Open sign in and see the shared button and field shapes', async () => {
    await page.goto('/auth/sign-in');
    const button = page.getByTestId('sign-in-submit');
    await expect(button).toHaveCSS('background-color', 'rgb(29, 92, 75)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('border-radius', '9999px');
    for (const control of [button, page.getByTestId('sign-in-email'), page.getByTestId('sign-in-password')]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await expect(page.getByTestId('sign-in-email')).toHaveCSS('border-radius', '12px');
  });
  await step(page, 'Tab through the clinic link and email field with a visible pine focus ring', async () => {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('clinic-name')).toBeFocused();
    await page.keyboard.press('Tab');
    const email = page.getByTestId('sign-in-email');
    await expect(email).toBeFocused();
    await expect(email).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(email).toHaveCSS('outline-style', 'solid');
    await expect(email).toHaveCSS('outline-width', '2px');
    await expect(email).toHaveCSS('outline-offset', '3px');
  });
  await step(page, 'Follow password recovery using the keyboard', async () => {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sign-in-password')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sign-in-submit')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('forgot-password-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('forgot-password-email')).toBeVisible();
  });
  await step(page, 'See shared problem and success notices with their words still present', async () => {
    await page.goto('/auth/sign-in?error=invalid');
    await expect(page.getByTestId('sign-in-error')).toContainText('The email address or password is not correct.');
    await expect(page.getByTestId('sign-in-error')).toHaveCSS('background-color', 'rgb(252, 235, 232)');
    await page.goto('/auth/sign-in?notice=password_reset');
    await expect(page.getByTestId('sign-in-notice')).toContainText('Your password has been changed.');
    await expect(page.getByTestId('sign-in-notice')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByTestId('sign-in-submit')).toHaveCSS('transition-duration', '0s');
  });
});

test('The shared header and page frame fit phones and 200% zoom, with client and staff widths capped at 720px and 1120px', async ({
  page,
}) => {
  await step(page, 'Sign in as a client and see the comfortable laptop reading width', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, PATIENT_1);
    await expectFrameToFit(page, 720, 32);
    await expect(page.getByTestId('nav-book')).toHaveAttribute('href', '/slots');
    await expect(page.getByTestId('nav-my-bookings')).toHaveAttribute('href', '/bookings');
  });
  await step(page, 'Use the shared navigation on a small phone without sideways scrolling', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await expectFrameToFit(page, 720, 20);
    await page.getByTestId('nav-book').click();
    await expect(page.getByTestId('show-slots')).toBeVisible();
    await expect(page.getByTestId('show-slots')).toHaveCSS('border-radius', '9999px');
    expect((await page.getByTestId('show-slots').boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });
  await step(page, 'Enlarge the laptop page to 200% and keep navigation within the screen', async () => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectFrameToFit(page, 720, 32);
    await page.getByTestId('nav-my-bookings').click();
    await expect(page.getByRole('heading', { name: 'My bookings', exact: true })).toBeVisible();
  });
  await step(page, 'Sign in as staff and see a wider laptop frame with clinic navigation', async () => {
    await page.getByTestId('sign-out').click();
    await signIn(page, ADMIN);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectFrameToFit(page, 1120, 32);
    await page.getByTestId('nav-admin').click();
    await expect(page.getByRole('heading', { name: 'Clinic bookings', exact: true })).toBeVisible();
  });
});
