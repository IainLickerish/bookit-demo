import { expect, test } from '@playwright/test';
import { query } from './support';

test('Account and page-not-found controls stay inside the viewport when content is enlarged to 200%', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 1200 });
  for (const path of [
    '/auth/sign-in',
    '/auth/sign-in?error=invalid',
    '/auth/sign-in?notice=password_reset',
    '/auth/forgot-password',
    '/auth/forgot-password?sent=1',
    '/auth/reset-password/account-layout-invalid-link',
    '/account-layout-missing-page',
  ]) {
    await page.goto(path);
    // CSS zoom enlarges both controls and text and exercises reflow in a headless browser.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(page.getByTestId('page-title')).toBeVisible();
    for (const control of await page.locator('main input:not([type="hidden"]), main button, main a').all()) {
      const box = (await control.boundingBox())!;
      expect(box.x, path).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, path).toBeLessThanOrEqual(640);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});

test('The error page keeps its existing title, description, retry control and keyboard focus inside a white card', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  // Temporarily hide only the token table in this disposable test database. Root branding can still load.
  await query('alter table password_reset_token rename to account_layout_hidden_tokens');
  try {
    await page.goto('/auth/reset-password/account-layout-error-check');
    const error = page.getByTestId('error-page');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error.getByTestId('page-title')).toHaveText('Something went wrong');
    await expect(error.getByTestId('page-title')).toHaveCSS('font-family', /Fraunces/);
    await expect(error.getByTestId('page-title')).toHaveCSS('font-weight', '500');
    await expect(error.getByTestId('page-heading')).toContainText(
      'Please try again. If it keeps happening, contact the clinic.',
    );
    await expect(error.getByTestId('fallback-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(error.getByTestId('fallback-card')).toHaveCSS('border-radius', '20px');
    await expect(error.getByTestId('retry-page')).toHaveText('Try again');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('clinic-name')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(error.getByTestId('retry-page')).toBeFocused();
    await expect(error.getByTestId('retry-page')).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('error-phone.png') });
    await page.setViewportSize({ width: 640, height: 1200 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    const card = (await error.getByTestId('fallback-card').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(640);
    await page.screenshot({ path: test.info().outputPath('error-enlarged.png') });
  } finally {
    await query('alter table account_layout_hidden_tokens rename to password_reset_token');
  }
  await page.goto('/auth/sign-in');
  await expect(page.getByTestId('sign-in-submit')).toBeVisible();
});
