import { expect, test } from '@playwright/test';
import {
  accountClinic,
  expectAccountAtBothWidths,
  expectAccountFields,
  expectAccountKeyboard,
  requestAccountReset,
  setAccountPassword,
  signInAccount,
} from './account-support';
import { demoPassword, mailTo, resetLink, step } from './support';

test('The refreshed password recovery cards keep all existing labels, instructions, links, validation and messages, with labelled full-width fields and pine pill actions at least 48px tall. Known and unknown email addresses receive the same answer, repeated requests remain limited, reset links stay private to the plain-text email, expire after 30 minutes and work once, and a newer link replaces an earli', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  let email = '';
  let clinicName = '';
  const changedPassword = 'a-new-password-for-the-card-check';
  let passwordChanged = false;
  const originalSession = await browser.newContext();
  const originalPage = await originalSession.newPage();
  let latestLink = '';
  const seen: string[] = [];

  try {
    const first = await step(
      page,
      'Request recovery from the labelled card and receive the same answer for known and unknown addresses',
      async () => {
        await page.goto('/auth/sign-in');
        const clinic = await accountClinic(page);
        clinicName = clinic.settings.clinicName;
        email = clinic.accounts.find((account) => account.email.startsWith('patient2@'))!.email;
        const unknown = `unknown-recovery@${clinic.domain}`;
        seen.push(...(await mailTo(email)).map((message) => message.ID));
        await signInAccount(originalPage, email);
        await expect(originalPage).toHaveURL(/\/bookings$/);
        await page.getByTestId('forgot-password-link').click();
        await expect(page.getByTestId('account-card')).toContainText(
          'Enter the email address you sign in with and we will email you a link to reset your password.',
        );
        await expectAccountFields(
          page,
          [['forgot-password-email', 'Email address', 'username']],
          'forgot-password-submit',
        );
        await expect(page.getByTestId('forgot-password-submit')).toHaveText('Email me a reset link');
        await expect(page.getByTestId('back-to-sign-in')).toHaveText('Back to sign in');
        await expectAccountKeyboard(page, ['forgot-password-email', 'forgot-password-submit', 'back-to-sign-in']);
        await requestAccountReset(page, email);
        await expectAccountAtBothWidths(page);
        const first = await resetLink(email, seen);
        seen.push(first.id);
        await requestAccountReset(page, unknown);
        await expectAccountAtBothWidths(page);
        expect(await mailTo(unknown)).toEqual([]);
        return first;
      },
    );

    await step(page, 'Read the plain-text email and open a newer link that replaces the first one', async () => {
      await requestAccountReset(page, email);
      const newer = await resetLink(email, seen);
      latestLink = newer.path;
      seen.push(newer.id);
      const mailBase = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
      const response = await page.request.get(`${mailBase}/api/v1/message/${newer.id}`);
      expect(response.ok()).toBe(true);
      const message = (await response.json()) as { Text: string; HTML: string };
      expect(message.Text).toContain(clinicName);
      expect(message.Text).toContain('within 30 minutes');
      expect(message.Text).toContain('The link works once.');
      expect(message.Text).toContain(latestLink);
      expect(message.HTML ?? '').toBe('');
      await page.goto(first.path);
      await expect(page.getByTestId('reset-password-invalid')).toHaveText(
        'This reset link has expired or has already been used.',
      );
      await expect(page.getByTestId('reset-password-invalid')).toHaveAttribute('role', 'alert');
      await expectAccountAtBothWidths(page);
      await page.getByTestId('request-new-link').click();
      await expect(page).toHaveURL(/\/auth\/forgot-password$/);
      await page.goto(latestLink);
      await expectAccountFields(
        page,
        [
          ['reset-password-new', 'New password', 'new-password'],
          ['reset-password-confirm', 'Repeat the new password', 'new-password'],
        ],
        'reset-password-submit',
      );
      await expect(page.getByTestId('reset-password-submit')).toHaveText('Set new password');
      await expect(page.getByTestId('reset-password-new')).toHaveAttribute('minlength', '12');
      await expect(page.getByTestId('reset-password-confirm')).toHaveAttribute('minlength', '12');
      await expectAccountKeyboard(page, ['reset-password-new', 'reset-password-confirm', 'reset-password-submit']);
      await expectAccountAtBothWidths(page);
    });

    await step(page, 'Keep required-field and password validation with announced errors in the same card', async () => {
      await setAccountPassword(page, 'short');
      expect(
        await page.getByTestId('reset-password-new').evaluate((node: HTMLInputElement) => node.validity.tooShort),
      ).toBe(true);
      await setAccountPassword(page, changedPassword, 'a-different-new-password');
      await expect(page.getByTestId('reset-password-error')).toHaveText('The two passwords do not match.');
      await expect(page.getByTestId('reset-password-error')).toHaveAttribute('role', 'alert');
      await expectAccountAtBothWidths(page);
      await setAccountPassword(page, 'x'.repeat(257));
      await expect(page.getByTestId('reset-password-error')).toHaveText('Choose a password of at least 12 characters.');
      await expectAccountAtBothWidths(page);
    });

    await step(page, 'Choose a new password and return to the unchanged sign-in success announcement', async () => {
      passwordChanged = true;
      await setAccountPassword(page, changedPassword);
      await expect(page).toHaveURL(/\/auth\/sign-in\?notice=password_reset$/);
      await expect(page.getByTestId('sign-in-notice')).toHaveText(
        'Your password has been changed. Sign in with your new password.',
      );
      await expect(page.getByTestId('sign-in-notice')).toHaveAttribute('role', 'status');
      await expectAccountAtBothWidths(page);
    });

    await step(page, 'See old sessions and the old password refused, then sign in with the new password', async () => {
      await originalPage.goto('/bookings');
      await expect(originalPage).toHaveURL(/\/auth\/sign-in$/);
      await signInAccount(page, email);
      await expect(page.getByTestId('sign-in-error')).toHaveText('The email address or password is not correct.');
      await signInAccount(page, email, changedPassword);
      await expect(page).toHaveURL(/\/bookings$/);
      await page.getByTestId('sign-out').click();
    });

    await step(page, 'Open the used link again and receive an announced refusal with a recovery link', async () => {
      await page.goto(latestLink);
      await expect(page.getByTestId('reset-password-invalid')).toBeVisible();
      await expect(page.getByTestId('reset-password-invalid')).toHaveAttribute('role', 'alert');
      await expect(page.getByTestId('reset-password-new')).toHaveCount(0);
      await expect(page.getByTestId('request-new-link')).toBeVisible();
      await expectAccountAtBothWidths(page);
    });

    await step(
      page,
      'Repeated requests keep the same private answer and stop sending links after the third request',
      async () => {
        await requestAccountReset(page, email);
        const third = await resetLink(email, seen);
        latestLink = third.path;
        seen.push(third.id);
        const before = (await mailTo(email)).map((message) => message.ID).sort();
        await requestAccountReset(page, email);
        await expectAccountAtBothWidths(page);
        expect((await mailTo(email)).map((message) => message.ID).sort()).toEqual(before);
        await page.goto(latestLink);
        await expect(page.getByTestId('reset-password-new')).toBeVisible();
      },
    );
  } finally {
    // Restore from a fresh browser session even if a failure left the main page signed in.
    const restoreContext = await browser.newContext();
    const restorePage = await restoreContext.newPage();
    try {
      await step(restorePage, 'Put the demonstration password back and check that sign-in still works', async () => {
        if (passwordChanged) {
          // Request the third link if an earlier assertion failed before the restoration link was issued.
          await restorePage.goto(latestLink);
          if (await restorePage.getByTestId('reset-password-invalid').count()) {
            await requestAccountReset(restorePage, email);
            latestLink = (await resetLink(email, seen)).path;
          }
          await restorePage.goto(latestLink);
          await setAccountPassword(restorePage, demoPassword());
          await expect(restorePage).toHaveURL(/\/auth\/sign-in\?notice=password_reset$/);
          await signInAccount(restorePage, email);
          await expect(restorePage).toHaveURL(/\/bookings$/);
          await restorePage.getByTestId('sign-out').click();
        }
        await restorePage.goto('/auth/sign-in');
        await expectAccountAtBothWidths(restorePage);
      });
    } finally {
      await restoreContext.close();
      await originalSession.close();
    }
  }
});
