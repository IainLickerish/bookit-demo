import { expect, test, type Page } from '@playwright/test';
import { ADMIN, PATIENT_3, mailTo, resetLink, signIn, step } from './support';

async function checkCard(page: Page, testId: string, maxWidth: number) {
  const card = page.getByTestId(testId);
  await expect(card).toHaveCount(1);
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-color', 'rgb(230, 225, 216)');
  await expect(card).toHaveCSS('border-width', '1px');
  await expect(card).toHaveCSS('border-style', 'solid');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).toHaveCSS('padding', '24px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
  const box = (await card.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(maxWidth);
  expect(Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('Sign-in uses a centred white card at most 440px wide on desktop and phone', async ({ page }) => {
  await step(page, 'Open sign-in on a desktop and see one centred premium card', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/auth/sign-in');
    await page.evaluate(() => document.fonts.ready);
    await checkCard(page, 'account-card', 440);
    await expect(page.getByTestId('account-card').locator('.card')).toHaveCount(0);
    await expect(page.getByTestId('page-heading').getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  });

  await step(page, 'Use sign-in on a small phone without sideways scrolling', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await checkCard(page, 'account-card', 440);
    const card = (await page.getByTestId('account-card').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(20);
    for (const id of ['sign-in-email', 'sign-in-password', 'sign-in-submit', 'forgot-password-link']) {
      const control = page.getByTestId(id);
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(card.x + 24);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width - 24);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  await step(page, 'See an incorrect-password warning inside the same card and tab to the email field', async () => {
    await page.getByTestId('sign-in-email').fill('account-card-check@patients.acmephysio.test');
    await page.getByTestId('sign-in-password').fill('incorrect-password-for-account-card');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('account-card').getByTestId('sign-in-error')).toContainText(
      'The email address or password is not correct.',
    );
    await checkCard(page, 'account-card', 440);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('clinic-name')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sign-in-email')).toBeFocused();
    await expect(page.getByTestId('sign-in-email')).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
  });
});

test('Password recovery and both reset-link states use narrow cards and their existing page titles', async ({
  page,
}) => {
  let path = '';
  let seen: string[] = [];
  await step(page, 'Open password recovery on a small phone and read its existing introduction', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/auth/forgot-password');
    await checkCard(page, 'account-card', 440);
    await expect(page.getByTestId('page-heading').getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByTestId('page-heading')).toContainText(
      'Enter the email address you sign in with and we will email you a link to reset your password.',
    );
    seen = (await mailTo(PATIENT_3)).map((message) => message.ID);
  });

  await step(page, 'Request a reset link and see the notice in the same narrow card', async () => {
    await page.getByTestId('forgot-password-email').fill(PATIENT_3);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('account-card').getByTestId('forgot-password-sent')).toContainText(
      'If an account uses that email address',
    );
    await checkCard(page, 'account-card', 440);
    path = (await resetLink(PATIENT_3, seen)).path;
  });

  await step(page, 'Open the emailed link and see the new-password form in its card', async () => {
    await page.goto(path);
    await checkCard(page, 'account-card', 440);
    await expect(
      page.getByTestId('page-heading').getByRole('heading', { name: 'Choose a new password' }),
    ).toBeVisible();
    await expect(page.getByTestId('account-card').getByLabel('New password', { exact: true })).toBeVisible();
    await expect(page.getByTestId('account-card').getByLabel('Repeat the new password')).toBeVisible();
    await expect(page.getByTestId('account-card').getByRole('button', { name: 'Set new password' })).toBeVisible();
  });

  await step(page, 'Enter different passwords and see the existing error in the same card', async () => {
    await page.getByTestId('reset-password-new').fill('account-layout-first-password');
    await page.getByTestId('reset-password-confirm').fill('account-layout-other-password');
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('account-card').getByTestId('reset-password-error')).toContainText(
      'The two passwords do not match.',
    );
    await checkCard(page, 'account-card', 440);
  });

  await step(page, 'Open an invalid link and use its existing route back to recovery', async () => {
    await page.goto('/auth/reset-password/account-layout-invalid-link');
    await expect(page.getByTestId('page-heading').getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByTestId('account-card').getByTestId('reset-password-invalid')).toContainText(
      'This reset link has expired or has already been used.',
    );
    await checkCard(page, 'account-card', 440);
    await page.getByRole('link', { name: 'Request a new link' }).click();
    await expect(page.getByTestId('forgot-password-submit')).toBeVisible();
  });
});

test('Staff home and page-not-found show serif page headers in white cards', async ({ page }) => {
  await step(page, 'Sign in as staff on a small phone and read the administration home', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, ADMIN);
    await expect(page).toHaveURL(/\/$/);
    await checkCard(page, 'home-card', 720);
    const heading = page.getByTestId('page-heading');
    await expect(heading.getByRole('heading', { name: 'Clinic administration' })).toHaveCSS('font-family', /Fraunces/);
    await expect(heading.getByTestId('admin-home')).toContainText('You are signed in as the clinic admin.');
  });

  await step(page, 'Open an unknown page and see the existing page-not-found title and start link', async () => {
    await page.goto('/account-layout-missing-page');
    await checkCard(page, 'fallback-card', 720);
    await expect(page.getByTestId('page-heading').getByRole('heading', { name: 'Page not found' })).toHaveCSS(
      'font-family',
      /Fraunces/,
    );
    await expect(page.getByTestId('fallback-card').getByRole('link', { name: 'Go to the start page' })).toBeVisible();
  });

  await step(page, 'Use the start link to return to the same staff home', async () => {
    await page.getByRole('link', { name: 'Go to the start page' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-card').getByRole('heading', { name: 'Clinic administration' })).toBeVisible();
  });
});
