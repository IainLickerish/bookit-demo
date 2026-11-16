import { expect, test } from '@playwright/test';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { launchServer, type RunningServer } from '../helpers/built-server';
import { TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { E2E_START, writeClock } from './support';

for (const slug of ['acme', 'beacon'] as const) {
  test(`${slug} shows its configured clinic name with local Fraunces, Figtree and the shared premium palette`, async ({
    page,
  }, info) => {
    const tenant = loadTenant(slug);
    const database = await startTestDatabase();
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
    } finally {
      await server?.stop();
      await database.stop();
    }
  });
}
