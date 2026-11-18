import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { query, signIn, STATE_FILE, type E2eState } from './support';
import { launchServer } from '../helpers/built-server';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import type { ReceivedMessage } from '../helpers/mail';

const state = (): E2eState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;

async function pageDesign(page: Page, title: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('page-header').getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByTestId('page-body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
  await expect(page.getByTestId('page-body')).toHaveCSS('color', 'rgb(22, 36, 31)');
  await expect(page.getByTestId('page-body')).toHaveCSS('font-family', /Figtree/);
  await expect(page.getByTestId('page-title')).toHaveCSS('font-family', /Fraunces/);
  await expect(page.getByTestId('page-title')).toHaveCSS('font-weight', '500');
  await expect(page.getByTestId('clinic-name')).toHaveCSS('font-family', /Fraunces/);
  expect(await page.evaluate(() => document.fonts.check('500 28px Fraunces'))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('400 16px Figtree'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function cardDesign(page: Page, selector: string): Promise<void> {
  const card = page.getByTestId(selector).first();
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
}

test('premium sign-in uses local fonts, the palette and accessible phone controls', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/auth/sign-in');
    await pageDesign(page, 'Sign in');
    await cardDesign(page, 'account-card');
    expect((await page.getByTestId('account-card').boundingBox())!.width).toBeLessThanOrEqual(440);
    await expect(page.getByTestId('sign-in-submit')).toHaveCSS('background-color', 'rgb(29, 92, 75)');
    await expect(page.getByTestId('sign-in-submit')).toHaveCSS('color', 'rgb(255, 255, 255)');
    for (const id of ['sign-in-email', 'sign-in-password', 'sign-in-submit']) {
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('clinic-name')).toBeFocused();
    await expect(page.getByTestId('clinic-name')).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
  }
  expect(fontRequests.some((url) => url.includes('fraunces'))).toBe(true);
  expect(fontRequests.some((url) => url.includes('figtree'))).toBe(true);
  expect(fontRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('sign-in-submit')).toHaveCSS('transition-duration', '0s');
});

test('booking and moving retain their actions inside the new phone layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, state().patient1);
  await pageDesign(page, 'My bookings');
  await expect(page.getByTestId('upcoming-title')).toHaveCSS('font-family', /Fraunces/);
  await page.getByTestId('nav-book').click();
  await page.getByTestId('date-input').fill('2026-10-22');
  await page.getByTestId('show-slots').click();
  await pageDesign(page, 'Book an appointment');
  await cardDesign(page, 'day-picker');
  await expect(page.getByTestId('shown-date')).toContainText('22 October 2026');
  const slot = page.getByTestId('slot-link').first();
  await expect(slot).toHaveCSS('font-variant-numeric', 'tabular-nums');
  expect((await slot.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await slot.click();
  await pageDesign(page, 'Confirm your booking');
  await cardDesign(page, 'account-card');
  const when = await page.getByTestId('book-when').textContent();
  await expect(page.getByTestId('booking-action-bar')).toHaveCSS('position', 'fixed');
  const confirmBox = (await page.getByTestId('confirm-booking').boundingBox())!;
  expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(844);
  await page.getByTestId('choose-different-time').scrollIntoViewIfNeeded();
  expect((await page.getByTestId('choose-different-time').boundingBox())!.y).toBeLessThan(confirmBox.y);
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
  await pageDesign(page, 'My bookings');
  await cardDesign(page, 'booking-row');
  const row = page.getByTestId('booking-row').filter({ hasText: when!.replace(/\s*\(.*$/, '').trim() });
  await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  await expect(row.getByTestId('booking-date')).toHaveText('22Oct');
  await expect(row.getByTestId('booking-status')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
  await row.getByTestId('reschedule-link').click();
  await pageDesign(page, 'Reschedule your appointment');
  await page.getByTestId('reschedule-to').first().click();
  await expect(page.getByTestId('notice')).toHaveText('Booking rescheduled.');
  await page.getByTestId('cancel-booking').first().click();
  await expect(page.getByTestId('booking-status').first()).toHaveText('Cancelled');
  await expect(page.getByTestId('booking-status').first()).toHaveCSS('background-color', 'rgb(241, 238, 232)');
});

test('staff home, filters, table and settings fit laptop and narrow screens', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill('admin@example.test');
  await page.getByTestId('sign-in-password').fill(state().password);
  await page.getByTestId('sign-in-submit').click();
  await pageDesign(page, 'Clinic administration');
  await page.getByTestId('nav-admin').click();
  for (const width of [1366, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await pageDesign(page, 'Clinic bookings');
    const shell = (await page.getByTestId('page-shell').boundingBox())!;
    expect(shell.width).toBeLessThanOrEqual(1120);
    if (width === 1366) expect(shell.width).toBe(1120);
    await cardDesign(page, 'admin-table-card');
    await expect(page.getByTestId('admin-table-scroll')).toHaveCSS('overflow-x', 'auto');
  }
  await page.getByTestId('admin-settings-link').click();
  await pageDesign(page, 'Clinic settings');
  await cardDesign(page, 'settings-form');
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toHaveText('Clinic settings saved.');
  await expect(page.getByTestId('admin-settings-saved')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
});

test('password pages and not-found retain their wording and plain text emails', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/auth/forgot-password');
  await pageDesign(page, 'Reset your password');
  await page.getByTestId('forgot-password-email').fill(state().patient2);
  await page.getByTestId('forgot-password-submit').click();
  await expect(page.getByTestId('forgot-password-sent')).toBeVisible();
  const receivedMail = () =>
    readFileSync(state().mailLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReceivedMessage)
      .filter((message) => message.to.includes(state().patient2))
      .at(-1);
  // Password emails are deliberately sent after the page responds.
  await expect.poll(() => receivedMail()?.raw).toContain('/auth/reset-password/');
  const mail = receivedMail()!;
  expect(mail.raw).toContain('Content-Type: text/plain');
  expect(mail.raw).not.toContain('text/html');
  const link = mail.raw.replace(/=\r?\n/g, '').match(/https?:\/\/[^\s]+\/auth\/reset-password\/[^\s]+/)![0];
  await page.goto(link);
  await pageDesign(page, 'Choose a new password');
  await cardDesign(page, 'account-card');
  await page.getByTestId('reset-password-new').fill(state().password);
  await page.getByTestId('reset-password-confirm').fill(state().password);
  await page.getByTestId('reset-password-submit').click();
  await pageDesign(page, 'Sign in');
  await expect(page.getByTestId('sign-in-notice')).toHaveText(
    'Your password has been changed. Sign in with your new password.',
  );
  await page.goto('/auth/reset-password/used-link');
  await pageDesign(page, 'Reset your password');
  await expect(page.getByTestId('reset-password-invalid')).toHaveCSS('background-color', 'rgb(252, 235, 232)');
  await page.goto('/missing-page');
  await pageDesign(page, 'Page not found');
});

test('the error page and retry control use the premium layout', async ({ page }) => {
  await signIn(page, state().patient1);
  await query('alter table booking rename to premium_design_unavailable_booking');
  try {
    await page.reload();
    await pageDesign(page, 'Something went wrong');
    await expect(page.getByTestId('error-page')).toHaveAttribute('role', 'alert');
    await cardDesign(page, 'error-page');
    await expect(page.getByTestId('retry-page')).toHaveText('Try again');
    await expect(page.getByTestId('retry-page')).toHaveCSS('background-color', 'rgb(29, 92, 75)');
    expect((await page.getByTestId('retry-page').boundingBox())!.height).toBeGreaterThanOrEqual(48);
  } finally {
    await query('alter table premium_design_unavailable_booking rename to booking');
  }
});

test('both clinics share the design and keep their booking and staff journeys', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of ['acme', 'beacon']) {
    const tenant = loadTenant(name);
    const database = await startTestDatabase();
    const password = randomBytes(24).toString('base64url');
    let server: Awaited<ReturnType<typeof launchServer>> | undefined;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await seedTenant(database.db, manualClock('2026-10-20T07:00:00.000Z'), {
        tenant,
        environment: 'local',
        passwords: Object.fromEntries(tenant.accounts.map((account) => [account.email, password])),
      });
      server = await launchServer('.next-e2e', {
        DATABASE_URL: database.url,
        BOOKIT_TEST_CLOCK: state().clockFile,
        BOOKIT_TENANT: tenant.tenant,
        BOOKIT_PRODUCT: tenant.product,
        BOOKIT_ENV: 'local',
        BOOKIT_MAIL_FROM: tenant.mailFrom,
      });
      expect(server.served).toBe(true);
      const page = await context.newPage();
      const logIn = async (role: 'patient' | 'admin') => {
        await page.goto(`${server!.url}/auth/sign-in`);
        await pageDesign(page, 'Sign in');
        await expect(page.getByTestId('clinic-name')).toHaveText(tenant.settings.clinicName);
        await page.getByTestId('sign-in-email').fill(tenant.accounts.find((account) => account.role === role)!.email);
        await page.getByTestId('sign-in-password').fill(password);
        await page.getByTestId('sign-in-submit').click();
      };
      await logIn('patient');
      await pageDesign(page, 'My bookings');
      await cardDesign(page, 'booking-row');
      await page.getByTestId('nav-book').click();
      await page.getByTestId('date-input').fill('2026-10-23');
      await page.getByTestId('show-slots').click();
      await pageDesign(page, 'Book an appointment');
      await expect(page.getByTestId('practitioner-select')).toContainText(tenant.practitioners[0]!.name);
      await page.getByTestId('slot-link').first().click();
      await pageDesign(page, 'Confirm your booking');
      await expect(page.getByTestId('book-when')).toContainText(`(${tenant.settings.sessionMinutes} minutes)`);
      await page.getByTestId('confirm-booking').click();
      await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
      const newBooking = page.getByTestId('booking-row').filter({ hasText: '23 Oct 2026' });
      const bookingId = await newBooking.getAttribute('data-booking-id');
      await newBooking.getByTestId('reschedule-link').click();
      await pageDesign(page, 'Reschedule your appointment');
      await page.getByTestId('reschedule-to').first().click();
      await expect(page.getByTestId('notice')).toHaveText('Booking rescheduled.');
      const moved = page.locator(`[data-booking-id="${bookingId}"]`);
      await moved.getByTestId('cancel-booking').click();
      await expect(moved.getByTestId('booking-status')).toHaveText('Cancelled');
      await page.getByTestId('sign-out').click();
      await page.setViewportSize({ width: 1366, height: 768 });
      await logIn('admin');
      await pageDesign(page, 'Clinic administration');
      await page.getByTestId('nav-admin').click();
      await pageDesign(page, 'Clinic bookings');
      await cardDesign(page, 'admin-table-card');
      await page.getByTestId('admin-filter').click();
      await expect(page.getByTestId('admin-row-count')).toHaveText('4 bookings');
      await page.getByTestId('admin-settings-link').click();
      await pageDesign(page, 'Clinic settings');
      await expect(page.getByTestId('admin-clinic-name')).toHaveValue(tenant.settings.clinicName);
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
    } finally {
      await context.close();
      await server?.stop();
      await database.stop();
    }
  }
});
