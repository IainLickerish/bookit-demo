import { expect, test } from '@playwright/test';
import { PATIENT_3, signIn, step } from './support';

test('Sign-in uses local Fraunces and Figtree, ivory and pine styling, and a pine keyboard focus ring', async ({
  page,
}) => {
  const fontRequests: string[] = [];
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
    requests.push(request.url());
  });

  await step(page, 'Open sign-in and see the clinic name and title in the local display font', async () => {
    await page.goto('/auth/sign-in');
    await page.evaluate(() => document.fonts.ready);
    const clinic = page.getByTestId('clinic-name');
    const title = page.getByRole('heading', { name: 'Sign in', exact: true });
    await expect(clinic).toHaveCSS('font-family', /Fraunces/);
    await expect(clinic).toHaveCSS('font-weight', '500');
    await expect(title).toHaveCSS('font-family', /Fraunces/);
    await expect(title).toHaveCSS('font-weight', '500');
    await expect(title).toHaveCSS('font-size', '32px');
    await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);
    await expect(page.getByTestId('sign-in-email')).toHaveCSS('font-family', /Figtree/);
    await expect(page.getByTestId('sign-in-submit')).toHaveCSS('font-family', /Figtree/);
    expect(await page.evaluate(() => document.fonts.check('500 32px Fraunces'))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('400 16px Figtree'))).toBe(true);
    expect(fontRequests.some((url) => url.includes('/fonts/fraunces-'))).toBe(true);
    expect(fontRequests.some((url) => url.includes('/fonts/figtree-'))).toBe(true);
    expect(
      requests.filter((url) => new URL(url).origin !== new URL(page.url()).origin),
      'fonts and styles load without contacting another company',
    ).toEqual([]);
  });

  await step(page, 'See ivory pages, a white header, pine pill controls and rounded fields', async () => {
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(22, 36, 31)');
    await expect(page.getByTestId('site-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const button = page.getByTestId('sign-in-submit');
    await expect(button).toHaveCSS('background-color', 'rgb(29, 92, 75)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('border-radius', '999px');
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    const email = page.getByTestId('sign-in-email');
    await expect(email).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(email).toHaveCSS('border-radius', '12px');
    await expect(email).toHaveCSS('border-color', 'rgb(140, 151, 146)');
    expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(page.getByTestId('forgot-password-link')).toHaveCSS('color', 'rgb(29, 92, 75)');
    await expect(page.getByTestId('clinic-accent')).toHaveCSS('background-color', 'rgb(185, 96, 63)');
    await expect(page.getByTestId('clinic-accent')).toHaveAttribute('aria-hidden', 'true');
  });

  await step(page, 'Tab to the clinic link and see a pine focus ring', async () => {
    await page.keyboard.press('Tab');
    const clinic = page.getByTestId('clinic-name');
    await expect(clinic).toBeFocused();
    await expect(clinic).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(clinic).toHaveCSS('outline-style', 'solid');
    await expect(clinic).toHaveCSS('outline-width', '2px');
  });

  await step(page, 'Request reduced motion and use sign-in on a small phone', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(page.getByTestId('sign-in-submit')).toHaveCSS('transition-duration', '0s');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCSS('font-size', '28px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('The clinic header wraps client navigation on a small phone and keeps sign-out usable', async ({ page }) => {
  await step(page, 'Sign in as a client on a small phone', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, PATIENT_3);
    await expect(page.getByTestId('clinic-name')).toHaveText('Acme Physio');
  });

  await step(page, 'See navigation wrap below the clinic name with comfortable touch targets', async () => {
    const clinic = (await page.getByTestId('clinic-name').boundingBox())!;
    const navigation = page.getByRole('navigation', { name: 'Main' });
    const nav = (await navigation.boundingBox())!;
    expect(nav.y).toBeGreaterThanOrEqual(clinic.y + clinic.height);
    const header = (await page.getByTestId('site-header').boundingBox())!;
    expect(header.x).toBeGreaterThanOrEqual(0);
    expect(header.x + header.width).toBeLessThanOrEqual(320);
    for (const control of [
      page.getByTestId('nav-book'),
      page.getByTestId('nav-my-bookings'),
      page.getByTestId('sign-out'),
    ]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
    }
    await expect(page.getByTestId('clinic-accent')).toHaveCount(1);
    await expect(page.getByTestId('clinic-accent')).toHaveAttribute('aria-hidden', 'true');
  });

  await step(page, 'Use Book and My bookings in the header', async () => {
    await page.getByTestId('nav-book').click();
    await expect(page).toHaveURL(/\/slots$/);
    await page.getByTestId('nav-my-bookings').click();
    await expect(page).toHaveURL(/\/bookings$/);
  });

  await step(page, 'Sign out from the phone header', async () => {
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByTestId('sign-in-submit')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  });
});

test('Sign-in errors use brick notices and password recovery uses sage notices with outline icons and announcements', async ({
  page,
}) => {
  await step(page, 'Open sign-in', async () => {
    await page.goto('/auth/sign-in');
    await expect(page.getByTestId('sign-in-submit')).toBeVisible();
  });

  await step(page, 'Enter incorrect details and see an announced brick warning with an outline icon', async () => {
    await page.getByTestId('sign-in-email').fill('shared-design-check@patients.acmephysio.test');
    await page.getByTestId('sign-in-password').fill('incorrect-password-for-design-check');
    await page.getByTestId('sign-in-submit').click();
    const error = page.getByTestId('sign-in-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText('The email address or password is not correct.');
    await expect(error).toHaveCSS('color', 'rgb(168, 38, 27)');
    await expect(error).toHaveCSS('background-color', 'rgb(252, 235, 232)');
    const icon = await error.evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return { image: style.backgroundImage, width: style.width, height: style.height, content: style.content };
    });
    expect(icon.width).toBe('20px');
    expect(icon.height).toBe('20px');
    expect(icon.content).toBe('""');
    expect(decodeURIComponent(icon.image)).toContain("stroke-width='1.5'");
    expect(decodeURIComponent(icon.image)).toContain("fill='none'");
  });

  await step(page, 'Ask for a reset link and see an announced sage notice with an outline icon', async () => {
    await page.getByTestId('forgot-password-link').click();
    await page.getByTestId('forgot-password-email').fill('shared-design-check@patients.acmephysio.test');
    await page.getByTestId('forgot-password-submit').click();
    const notice = page.getByTestId('forgot-password-sent');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toContainText('If an account uses that email address');
    await expect(notice).toHaveCSS('color', 'rgb(29, 92, 75)');
    await expect(notice).toHaveCSS('background-color', 'rgb(233, 241, 236)');
    const icon = await notice.evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return { image: style.backgroundImage, width: style.width, height: style.height, content: style.content };
    });
    expect(icon.width).toBe('20px');
    expect(icon.height).toBe('20px');
    expect(icon.content).toBe('""');
    expect(decodeURIComponent(icon.image)).toContain("stroke-width='1.5'");
    expect(decodeURIComponent(icon.image)).toContain("fill='none'");
  });
});
