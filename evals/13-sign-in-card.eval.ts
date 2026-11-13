import { expect, test } from '@playwright/test';
import { accountClinic, expectAccountCard, expectAccountFields, signInAccount } from './account-support';
import { step } from './support';

test('The refreshed sign-in card keeps every existing label, action, recovery link, error and success message unchanged, with labelled full-width fields and a pine pill action at least 48px tall. Valid client and staff accounts reach their existing destinations; wrong passwords and unknown accounts receive the same refusal. Visitors cannot reach protected pages, clients cannot reach staff pages or anoth', async ({
  page,
}) => {
  const clinic = await step(
    page,
    'Open protected pages as a visitor and arrive at the refreshed sign-in card',
    async () => {
      for (const path of ['/bookings', '/slots', '/admin', '/admin/settings']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/auth\/sign-in$/);
        await expectAccountCard(page);
      }
      return accountClinic(page);
    },
  );
  const firstClient = clinic.accounts.find((account) => account.email.startsWith('patient1@'))!.email;
  const secondClient = clinic.accounts.find((account) => account.email.startsWith('patient2@'))!.email;
  const staff = clinic.accounts.find((account) => account.role === 'admin')!.email;

  await step(
    page,
    'Use labelled fields and follow the sign-in controls with a keyboard at enlarged phone size',
    async () => {
      await page.setViewportSize({ width: 640, height: 900 });
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      await expectAccountFields(
        page,
        [
          ['sign-in-email', 'Email address', 'username'],
          ['sign-in-password', 'Password', 'current-password'],
        ],
        'sign-in-submit',
      );
      await expect(page.getByTestId('sign-in-submit')).toHaveText('Sign in');
      await expect(page.getByTestId('forgot-password-link')).toHaveText('Forgot your password?');
      await expect(page.getByTestId('forgot-password-link')).toHaveCSS('min-height', '44px');
      for (const id of ['clinic-name', 'sign-in-email', 'sign-in-password', 'sign-in-submit', 'forgot-password-link']) {
        await page.keyboard.press('Tab');
        await expect(page.getByTestId(id)).toBeFocused();
        await expect(page.getByTestId(id)).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
        await expect(page.getByTestId(id)).toHaveCSS('outline-width', '3px');
        await expect(page.getByTestId(id)).toHaveCSS('outline-style', 'solid');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/auth\/forgot-password$/);
      await page.getByTestId('back-to-sign-in').click();
      await page.evaluate(() => {
        document.documentElement.style.zoom = '1';
      });
      await expectAccountCard(page);
    },
  );

  await step(page, 'Receive the same announced refusal for a wrong password and an unknown account', async () => {
    for (const email of [firstClient, `unknown@${clinic.domain}`]) {
      await signInAccount(page, email, 'a-deliberately-wrong-password');
      await expect(page).toHaveURL(/\/auth\/sign-in\?error=invalid$/);
      await expect(page.getByTestId('sign-in-error')).toHaveText('The email address or password is not correct.');
      await expect(page.getByTestId('sign-in-error')).toHaveAttribute('role', 'alert');
      await expectAccountCard(page);
      await expect(page.getByTestId('forgot-password-link')).toBeVisible();
    }
  });

  let ownedBooking = '';
  await step(page, 'Sign in as a client and arrive at My bookings', async () => {
    await signInAccount(page, firstClient);
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByTestId('nav-my-bookings')).toBeVisible();
    ownedBooking = (await page.getByTestId('booking-row').first().getAttribute('data-booking-id')) ?? '';
    expect(ownedBooking).not.toBe('');
  });

  await step(page, 'Sign in as another client and be refused staff tools and the first client’s booking', async () => {
    await page.getByTestId('sign-out').click();
    await signInAccount(page, secondClient);
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.locator(`[data-booking-id="${ownedBooking}"]`)).toHaveCount(0);
    await page.goto(`/bookings/${ownedBooking}/reschedule`);
    await expect(page.getByTestId('current-when')).toHaveCount(0);
    await expect(page.getByTestId('reschedule-to')).toHaveCount(0);
    for (const path of ['/admin', '/admin/settings']) {
      await page.goto(path);
      await expect(page.getByTestId('admin-filter')).toHaveCount(0);
      await expect(page.getByTestId('admin-save-settings')).toHaveCount(0);
    }
    expect((await page.request.get('/api/admin/export')).status()).toBeGreaterThanOrEqual(400);
  });

  await step(page, 'Sign in as staff and arrive at the existing clinic home and tools', async () => {
    await page.getByTestId('sign-out').click();
    await signInAccount(page, staff);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('admin-home-card')).toBeVisible();
    await page.getByTestId('home-clinic-bookings').click();
    await expect(page.getByTestId('admin-filter')).toBeVisible();
    await page.getByTestId('admin-settings-link').click();
    await expect(page.getByTestId('admin-save-settings')).toBeVisible();
  });

  await step(page, 'Sign out and see the unchanged password-changed announcement and recovery link', async () => {
    await page.getByTestId('sign-out').click();
    await page.goto('/auth/sign-in?notice=password_reset');
    await expectAccountCard(page);
    await expect(page.getByTestId('sign-in-notice')).toHaveText(
      'Your password has been changed. Sign in with your new password.',
    );
    await expect(page.getByTestId('sign-in-notice')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('forgot-password-link')).toHaveAttribute('href', '/auth/forgot-password');
  });
});
