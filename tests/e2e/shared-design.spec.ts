import { expect, test } from '@playwright/test';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { launchServer, type RunningServer } from '../helpers/built-server';
import { TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { startSmtpReceiver } from '../helpers/mail';
import { E2E_START, writeClock } from './support';

for (const slug of ['acme', 'beacon'] as const) {
  test(`${slug} uses its configured name and the premium design on sign-in and booking pages`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const tenant = loadTenant(slug);
    const database = await startTestDatabase();
    const smtp = await startSmtpReceiver();
    let server: RunningServer | undefined;
    try {
      await seedTenant(database.db, manualClock(E2E_START), {
        tenant,
        environment: 'local',
        passwords: Object.fromEntries(tenant.accounts.map((account) => [account.email, TEST_PASSWORD])),
      });
      const clockFile = info.outputPath('clock.json');
      writeClock(clockFile, E2E_START);
      // Reuse the test-clock build made by the repository's browser global setup.
      server = await launchServer('.next-e2e', {
        DATABASE_URL: database.url,
        BOOKIT_TEST_CLOCK: clockFile,
        BOOKIT_TENANT: tenant.tenant,
        BOOKIT_PRODUCT: tenant.product,
        BOOKIT_ENV: 'local',
        BOOKIT_MAIL_FROM: tenant.mailFrom,
        BOOKIT_SMTP_URL: smtp.url,
      });
      expect(server.served).toBe(true);
      await page.goto(`${server.url}/auth/sign-in`);
      await page.evaluate(() => document.fonts.ready);
      const name = page.getByTestId('clinic-name');
      await expect(name).toHaveText(tenant.settings.clinicName);
      await expect(name).toHaveCSS('font-family', /Fraunces/);
      await expect(name).toHaveCSS('font-weight', '500');
      await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
      await expect(page.getByTestId('sign-in-submit')).toHaveCSS('background-color', 'rgb(29, 92, 75)');
      const card = page.getByTestId('account-card');
      await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      expect((await card.boundingBox())!.width).toBeLessThanOrEqual(440);
      await expect(card.getByTestId('page-title')).toHaveText('Sign in');
      expect(await page.evaluate(() => document.fonts.check('500 24px Fraunces'))).toBe(true);
      expect(await page.evaluate(() => document.fonts.check('400 16px Figtree'))).toBe(true);
      for (const family of ['fraunces', 'figtree']) {
        const font = await page.request.get(
          `${server.url}/fonts/${family}-latin-${family === 'fraunces' ? 'full' : 'wght'}-normal.woff2`,
        );
        expect(font.status()).toBe(200);
        expect(font.headers()['content-type']).toContain('font/woff2');
        const licence = await page.request.get(`${server.url}/fonts/${family}-OFL.txt`);
        expect(licence.status()).toBe(200);
        expect(await licence.text()).toContain('SIL OPEN FONT LICENSE Version 1.1');
      }
      await page.screenshot({ path: info.outputPath('sign-in-desktop.png') });
      await page.setViewportSize({ width: 320, height: 740 });
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCSS('font-size', '28px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('sign-in-phone.png') });
      const patient = tenant.accounts.find((account) => account.email.startsWith('patient2@'))!;
      await page.getByTestId('sign-in-email').fill(patient.email);
      await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page).toHaveURL(/\/bookings$/);
      await page.getByTestId('nav-book').click();
      await page.getByTestId('date-input').fill('2026-12-04');
      await page.getByTestId('show-slots').click();
      await expect(page.getByTestId('day-picker')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.getByTestId('times-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      const choice = page.getByRole('link', { name: /09:00$/ });
      await expect(choice).toHaveCSS('font-variant-numeric', 'tabular-nums');
      expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await choice.click();
      await expect(page.getByTestId('booking-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      expect((await page.getByTestId('booking-card').boundingBox())!.width).toBeLessThanOrEqual(440);
      await expect(page.getByTestId('book-when')).toContainText(`(${tenant.settings.sessionMinutes} minutes)`);
      await expect(page.getByTestId('booking-action-bar')).toHaveCSS('position', 'fixed');
      await expect(page.getByTestId('book-phone')).toHaveValue('');
      const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
      await page.screenshot({ path: info.outputPath('confirmation-phone.png') });
      await page.getByTestId('confirm-booking').click();
      await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
      const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
      await expect(row).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(row).toHaveCSS('border-radius', '20px');
      await expect(row.getByTestId('booking-date-day')).toHaveText('4');
      await expect(row.getByTestId('booking-date-month')).toHaveText('Dec');
      await expect(row.getByTestId('booking-date-tile')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
      await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
      await expect(row.getByTestId('booking-status')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('my-bookings-phone.png') });
      await row.getByTestId('reschedule-link').click();
      await expect(page.getByTestId('page-title')).toHaveText('Reschedule your appointment');
      await expect(page.getByTestId('current-when')).toContainText(when);
      await expect(page.getByTestId('day-picker')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      const nextTime = tenant.tenant === 'acme' ? /09:45$/ : /09:30$/;
      await expect(page.getByRole('button', { name: nextTime })).toHaveCSS('font-variant-numeric', 'tabular-nums');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('move-phone.png') });
    } finally {
      await server?.stop();
      await smtp.stop();
      await database.stop();
    }
  });
}
