import { expect, test, type Page } from '@playwright/test';
import { PATIENT_1, demoPassword, resetLink, step } from './support';

const NEW_PASSWORD = 'a-new-password-for-this-check';

async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(password);
  await page.getByTestId('sign-in-submit').click();
}

async function askForReset(page: Page, email: string): Promise<string> {
  await page.goto('/auth/sign-in');
  await page.getByTestId('forgot-password-link').click();
  await page.getByTestId('forgot-password-email').fill(email);
  await page.getByTestId('forgot-password-submit').click();
  await expect(page).toHaveURL(/\/auth\/forgot-password\?sent=1$/);
  return (await page.getByTestId('forgot-password-sent').textContent()) ?? '';
}

async function choosePassword(page: Page, path: string, password: string): Promise<void> {
  await page.goto(path);
  await page.getByTestId('reset-password-new').fill(password);
  await page.getByTestId('reset-password-confirm').fill(password);
  await page.getByTestId('reset-password-submit').click();
  await expect(page).toHaveURL(/\/auth\/sign-in\?notice=password_reset$/);
}

test('A wrong password is refused without saying whether the email address or the password was wrong', async ({
  page,
}) => {
  const refused = 'The email address or password is not correct.';
  await step(page, 'Open the sign-in page', async () => {
    await page.goto('/auth/sign-in');
    await expect(page.getByTestId('sign-in-email')).toBeVisible();
  });
  await step(page, "Enter a client's email address with the wrong password, and be refused", async () => {
    await signInWith(page, PATIENT_1, 'not-the-right-password');
    await expect(page.getByTestId('sign-in-error')).toHaveText(refused);
    await expect(page).toHaveURL(/\/auth\/sign-in\?error=invalid$/);
  });
  await step(page, 'Enter an email address with no account, and see exactly the same message', async () => {
    await signInWith(page, 'nobody@patients.acmephysio.test', 'not-the-right-password');
    await expect(page.getByTestId('sign-in-error')).toHaveText(refused);
  });
});

test('A client who forgot their password can reset it by email and sign in with the new one', async ({
  page,
  browser,
}) => {
  const { path, id } = await step(page, 'Ask for a password reset from the sign-in page', async () => {
    const answer = await askForReset(page, PATIENT_1);
    expect(
      await askForReset(page, 'nobody@patients.acmephysio.test'),
      'the same answer whether or not an account exists',
    ).toBe(answer);
    await expect(page.locator('body')).not.toContainText('/auth/reset-password/');
    return resetLink(PATIENT_1);
  });
  await step(page, 'Open the link in the reset email and choose a new password', async () => {
    await choosePassword(page, path, NEW_PASSWORD);
    await expect(page.getByTestId('sign-in-notice')).toHaveText(
      'Your password has been changed. Sign in with your new password.',
    );
  });
  await step(page, 'See the old password refused and the new one work', async () => {
    await signInWith(page, PATIENT_1, demoPassword());
    await expect(page.getByTestId('sign-in-error')).toBeVisible();
    await signInWith(page, PATIENT_1, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/bookings$/);
  });
  await step(page, 'See that the reset link works only once', async () => {
    await page.goto(path);
    await expect(page.getByTestId('reset-password-invalid')).toBeVisible();
  });
  // The other checks sign in with the demo password, so it is put back.
  const fresh = await (await browser.newContext()).newPage();
  await step(fresh, 'Put the demo password back', async () => {
    await askForReset(fresh, PATIENT_1);
    await choosePassword(fresh, (await resetLink(PATIENT_1, [id])).path, demoPassword());
    await signInWith(fresh, PATIENT_1, demoPassword());
    await expect(fresh).toHaveURL(/\/bookings$/);
  });
});
