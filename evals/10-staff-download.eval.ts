import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ADMIN, signIn, step } from './support';

test('Staff at both clinics download filtered bookings with accented client names', async ({ browser, baseURL }) => {
  for (const clinic of [
    { name: 'Acme Physio', url: baseURL, admin: ADMIN, client: 'Zoë Brontë' },
    {
      name: 'Beacon Dental',
      url: process.env.EVAL_BEACON_BASE_URL ?? 'http://localhost:4201',
      admin: 'admin@beacondental.test',
      client: 'Róisín Murphy',
    },
  ]) {
    const context = await browser.newContext({ baseURL: clinic.url });
    try {
      const page = await context.newPage();
      await step(page, `Sign in at ${clinic.name} and find the confirmed booking`, async () => {
        await signIn(page, clinic.admin);
        await expect(page.getByTestId('clinic-name')).toHaveText(clinic.name);
        await page.getByTestId('nav-admin').click();
        await page.getByTestId('admin-status').selectOption('confirmed');
        await page.getByTestId('admin-filter').click();
        await expect(page).toHaveURL(/[?&]status=confirmed(?:&|$)/);
        await expect(page.getByTestId('admin-booking-row').filter({ hasText: clinic.client })).toContainText(
          'Confirmed',
        );
      });

      await step(page, `Download the filtered bookings from ${clinic.name} and check the client's name`, async () => {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10_000 }),
          page.getByTestId('admin-export').click(),
        ]);
        expect(download.suggestedFilename()).toBe('bookings.csv');
        const csv = await readFile(await download.path(), 'utf8');
        expect(csv.split('\r\n').length).toBeGreaterThan(2);
        expect(csv).toContain(`"${clinic.client}"`);
      });
    } finally {
      await context.close();
    }
  }
});
