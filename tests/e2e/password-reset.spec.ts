import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loadState, mailText, receivedMail, serverLogLines } from './support';

const NEW_PASSWORD = 'a-new-test-only-password';

/** Waits for a reset email to `to` (it is sent after the response) and returns the link in it. */
async function resetLinkFor(to: string, after: number): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(() => {
      const message = receivedMail()
        .slice(after)
        .find((m) => m.to.includes(to) && mailText(m.raw).includes('/auth/reset-password/'));
      link = message
        ? /http:\/\/127\.0\.0\.1:\d+\/auth\/reset-password\/[A-Za-z0-9_-]+/.exec(mailText(message.raw))?.[0]
        : undefined;
      return link;
    })
    .toBeTruthy();
  return link!;
}

test.describe.configure({ mode: 'serial' });

test.describe('BookIt password reset journey (bead supportagents-8uvs; DEF-05 baseline)', () => {
  test('the old /account/reset-password path does not exist', async ({ request }) => {
    expect((await request.get('/account/reset-password')).status()).toBe(404);
  });

  test('request a reset, receive the email, set a new password and sign in with it', async ({ page }) => {
    const { patient2, password } = loadState();
    const mailBefore = receivedMail().length;

    await page.goto('/auth/sign-in');
    await page.getByTestId('forgot-password-link').click();
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);

    // An address with no account gets exactly the same answer.
    await page.getByTestId('forgot-password-email').fill('nobody@patients.example.test');
    await page.getByTestId('forgot-password-submit').click();
    await expect(page).toHaveURL(/\/auth\/forgot-password\?sent=1$/);
    const neutral = await page.getByTestId('forgot-password-sent').textContent();

    await page.getByTestId('forgot-password-email').fill(patient2);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page).toHaveURL(/\/auth\/forgot-password\?sent=1$/);
    await expect(page.getByTestId('forgot-password-sent')).toHaveText(neutral ?? '');
    await expect(page.locator('body')).not.toContainText('/auth/reset-password/');

    const link = await resetLinkFor(patient2, mailBefore);
    expect(
      receivedMail()
        .slice(mailBefore)
        .filter((m) => m.to.includes('nobody@patients.example.test')),
    ).toHaveLength(0);

    await page.goto(link);
    await page.getByTestId('reset-password-new').fill(NEW_PASSWORD);
    await page.getByTestId('reset-password-confirm').fill(`${NEW_PASSWORD}-different`);
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('reset-password-error')).toHaveText('The two passwords do not match.');

    await page.getByTestId('reset-password-new').fill(NEW_PASSWORD);
    await page.getByTestId('reset-password-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('reset-password-submit').click();
    await expect(page).toHaveURL(/\/auth\/sign-in\?notice=password_reset$/);
    await expect(page.getByTestId('sign-in-notice')).toHaveText(
      'Your password has been changed. Sign in with your new password.',
    );

    await page.getByTestId('sign-in-email').fill(patient2);
    await page.getByTestId('sign-in-password').fill(password);
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toBeVisible();

    await page.getByTestId('sign-in-email').fill(patient2);
    await page.getByTestId('sign-in-password').fill(NEW_PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    await expect(page).toHaveURL(/\/bookings$/);

    // The link worked once.
    await page.goto(link);
    await expect(page.getByTestId('reset-password-invalid')).toBeVisible();

    // The token never reaches the server log.
    const token = link.split('/').at(-1)!;
    expect(readFileSync(loadState().serverLog, 'utf8')).not.toContain(token);
    expect(serverLogLines().filter((l) => l.route === '/auth/reset-password/[token]').length).toBeGreaterThan(0);
    expect(serverLogLines().find((l) => l.event === 'email.password_reset.sent')).toBeTruthy();
  });
});
