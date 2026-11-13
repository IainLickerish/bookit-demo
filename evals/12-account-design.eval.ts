import { expect, test } from '@playwright/test';
import { accountClinic, expectAccountAtBothWidths, requestAccountReset, setAccountPassword } from './account-support';
import { mailTo, resetLink, step } from './support';

test('For both clinics, sign-in, forgot-password and choose-a-new-password screens, including their error and success states, use the shared ivory, pine and white design with locally served Fraunces headings and Figtree text. Each has a short heading and one centred white card no wider than 440px, with no nested cards, 24px card padding and no sideways page scrolling at phone and laptop widths (DS-2 to ', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const outsideFonts: string[] = [];
  const localFonts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === 'font') {
      localFonts.push(url.pathname);
      if (url.origin !== new URL(page.url()).origin) outsideFonts.push(url.href);
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) outsideFonts.push(url.href);
  });

  await step(page, 'See the centred sign-in card on a small phone and a laptop', async () => {
    await page.goto('/auth/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
    await expectAccountAtBothWidths(page);
    for (const family of ['Fraunces', 'Figtree']) {
      expect(
        await page.evaluate(async (name) => (await document.fonts.load(`500 16px "${name}"`, 'Clinic')).length, family),
      ).toBeGreaterThan(0);
    }
  });

  await step(page, 'See an unchanged sign-in refusal within the same card', async () => {
    await page.getByTestId('sign-in-email').fill('unknown@patients.example.test');
    await page.getByTestId('sign-in-password').fill('a-deliberately-wrong-password');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toHaveAttribute('role', 'alert');
    await expectAccountAtBothWidths(page);
  });

  await step(page, 'See the password-changed notice in the sign-in card', async () => {
    await page.goto('/auth/sign-in?notice=password_reset');
    await expect(page.getByTestId('sign-in-notice')).toHaveAttribute('role', 'status');
    await expectAccountAtBothWidths(page);
  });

  await step(page, 'Follow password recovery and read the existing instructions', async () => {
    await page.getByTestId('forgot-password-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reset your password');
    await expect(page.getByTestId('account-card')).toContainText(
      'Enter the email address you sign in with and we will email you a link to reset your password.',
    );
    await expectAccountAtBothWidths(page);
  });

  const link = await step(page, 'Ask for a reset email and see the success banner in the recovery card', async () => {
    const clinic = await accountClinic(page);
    const email = clinic.accounts.find((account) => account.email.startsWith('patient3@'))!.email;
    const seen = (await mailTo(email)).map((message) => message.ID);
    await requestAccountReset(page, email);
    await expectAccountAtBothWidths(page);
    return (await resetLink(email, seen)).path;
  });

  await step(page, 'Open the emailed link and see one new-password card at both screen sizes', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a new password');
    await expectAccountAtBothWidths(page);
  });

  await step(page, 'See both password validation messages without losing the card layout', async () => {
    await setAccountPassword(page, 'a-long-enough-password', 'a-different-password');
    await expect(page.getByTestId('reset-password-error')).toHaveText('The two passwords do not match.');
    await expectAccountAtBothWidths(page);
    await setAccountPassword(page, 'x'.repeat(257));
    await expect(page.getByTestId('reset-password-error')).toHaveText('Choose a password of at least 12 characters.');
    await expect(page.getByTestId('reset-password-error')).toHaveAttribute('role', 'alert');
    await expectAccountAtBothWidths(page);
  });

  await step(page, 'See a calm invalid-link card with a way forward and only locally supplied fonts', async () => {
    await page.goto('/auth/reset-password/not-a-valid-reset-link');
    await expect(page.getByTestId('reset-password-invalid')).toHaveText(
      'This reset link has expired or has already been used.',
    );
    await expect(page.getByTestId('request-new-link')).toHaveText('Request a new link');
    await expectAccountAtBothWidths(page);
    expect(localFonts.some((path) => path.startsWith('/fonts/fraunces-'))).toBe(true);
    expect(localFonts.some((path) => path.startsWith('/fonts/figtree-'))).toBe(true);
    expect(outsideFonts).toEqual([]);
  });
});
