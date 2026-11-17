import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';
import { bookings } from '@/db/schema';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { createPasswordResetLimiter } from '@/server/auth/rate-limit';
import { createUser } from '@/server/users';
import { captureLogs } from '../helpers/logs';
import { seedTenant } from '@/server/seed/seed';
import { loadTenant } from '@/server/seed/tenant';
import { launchServer, type RunningServer } from '../helpers/built-server';
import { TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { startSmtpReceiver } from '../helpers/mail';
import { E2E_START, writeClock } from './support';

// Review actual rendered colours, including text whose background comes from a parent card or banner.
function contrast(foreground: string, background: string): number {
  const luminance = (colour: string) => {
    const channels = colour
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function reviewLayout(page: Page, info: TestInfo, state: string, clinicName: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('clinic-name')).toHaveText(clinicName);
  await expect(page.getByTestId('clinic-name')).toHaveCSS('font-family', /Fraunces/);
  await expect(page.getByTestId('clinic-name')).toHaveCSS('font-weight', '500');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
  await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);
  await expect(page.locator('main h1')).toHaveCount(1);
  for (const heading of await page.locator('main h1, main h2').all()) {
    await expect(heading).toHaveCSS('font-family', /Fraunces/);
    await expect(heading).toHaveCSS('font-weight', '500');
  }
  expect(await page.locator('main h3, main h4, main h5, main h6').count()).toBe(0);
  expect(
    await page.evaluate(() => document.fonts.check('500 28px Fraunces') && document.fonts.check('400 16px Figtree')),
  ).toBe(true);
  await expect(page.locator('.card .card')).toHaveCount(0);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 320, height: 740 },
    { width: 640, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(
      (zoom) => {
        document.documentElement.style.zoom = zoom;
      },
      viewport.width === 640 ? '2' : '1',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), state).toBe(true);
    for (const control of await page
      .locator('main input:not([type="hidden"]), main select, main button, main a')
      .all()) {
      const box = (await control.boundingBox())!;
      expect(box.x, state).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, state).toBeLessThanOrEqual(viewport.width);
      await expect(control).toHaveCSS('font-family', /Figtree/);
      if (await control.evaluate((element) => element instanceof HTMLInputElement && element.type === 'checkbox')) {
        expect((await control.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      } else {
        expect(box.height, state).toBeGreaterThanOrEqual(44);
      }
    }
    const target = page
      .locator('main input:not([type="hidden"]), main select, main button, main a, main [tabindex="0"]')
      .first();
    if (await target.count()) {
      await target.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
      await expect(target).toHaveCSS('outline-style', 'solid');
      await expect(target).toHaveCSS('outline-width', '2px');
    }
    await page
      .getByTestId('site-header')
      .screenshot({ path: info.outputPath(`${state}-header-${viewport.width}.png`) });
    await page.screenshot({ path: info.outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  }
  const pairs = await page.locator('main').evaluate((root) =>
    Array.from(root.querySelectorAll('*'))
      .filter(
        (element) =>
          element.getClientRects().length > 0 &&
          Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
      )
      .map((element) => {
        let parent: Element | null = element;
        let background = 'rgb(250, 248, 244)';
        while (parent) {
          const colour = getComputedStyle(parent).backgroundColor;
          if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') {
            background = colour;
            break;
          }
          parent = parent.parentElement;
        }
        return { foreground: getComputedStyle(element).color, background };
      }),
  );
  for (const pair of pairs)
    expect(
      contrast(pair.foreground, pair.background),
      `${state}: ${pair.foreground} on ${pair.background}`,
    ).toBeGreaterThanOrEqual(4.5);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });
}

// Reset links and fixture passwords must not be retained in browser traces.
test.use({ trace: 'off' });

for (const slug of ['acme', 'beacon'] as const) {
  test(`${slug} uses its configured name and the premium design across account, booking, staff and fallback states`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
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
      const fontOrigins = new Set<string>();
      page.on('request', (request) => {
        if (request.resourceType() === 'font') fontOrigins.add(new URL(request.url()).origin);
      });
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
      const bookingPath = (await choice.getAttribute('href'))!;
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
      const movePath = new URL(page.url()).pathname;
      const bookingId = movePath.split('/')[2]!;
      const review = (state: string) => reviewLayout(page, info, state, tenant.settings.clinicName);
      await review('moving');
      await database.db
        .update(bookings)
        .set({ rescheduleCount: tenant.settings.maxReschedulesPerBooking })
        .where(eq(bookings.id, bookingId));
      await page.goto(`${server.url}${movePath}`);
      await expect(page.getByTestId('reschedule-limit')).toBeVisible();
      await review('move-limit');
      await database.db.update(bookings).set({ rescheduleCount: 0 }).where(eq(bookings.id, bookingId));
      await page.goto(`${server.url}${bookingPath}`);
      await expect(page.getByTestId('slot-taken')).toBeVisible();
      await review('unavailable-time');
      // A different time remains available for reviewing the confirmation form at every size.
      await page.goto(`${server.url}/slots?date=2026-12-04`);
      await review('available-times');
      await page.getByRole('link', { name: nextTime }).click();
      await review('confirmation');
      await page.goto(`${server.url}/bookings?error=slot_unavailable`);
      await expect(page.getByTestId('booking-error')).toBeVisible();
      await review('bookings-error');
      await page.getByTestId('booking-row').filter({ hasText: when }).getByTestId('cancel-booking').click();
      await expect(page.getByTestId('notice')).toContainText('Booking cancelled.');
      await review('bookings-cancelled');
      await page.goto(`${server.url}${movePath}`);
      await expect(page.getByTestId('not-reschedulable')).toBeVisible();
      await review('unavailable-move');
      writeClock(clockFile, '2026-10-20T18:00:00.000Z');
      await page.goto(`${server.url}/slots?date=2026-10-20`);
      await expect(page.getByTestId('no-slots')).toBeVisible();
      await review('empty-times');
      writeClock(clockFile, E2E_START);
      await page.getByTestId('sign-out').click();
      const empty = await createUser(database.db, manualClock(E2E_START), {
        email: 'layout-review@patients.example.test',
        name: 'Layout Review Client',
        role: 'patient',
        password: TEST_PASSWORD,
      });
      await page.goto(`${server.url}/auth/sign-in`);
      await page.getByTestId('sign-in-email').fill(empty.email);
      await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page.getByTestId('no-upcoming')).toBeVisible();
      await review('empty-bookings');
      await page.getByTestId('sign-out').click();
      const admin = tenant.accounts.find((account) => account.role === 'admin')!;
      await page.goto(`${server.url}/auth/sign-in`);
      await page.getByTestId('sign-in-email').fill(admin.email);
      await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Clinic administration');
      await review('staff-home');
      await page.getByTestId('nav-admin').click();
      await review('staff-bookings');
      await page.getByTestId('admin-date').fill('2026-12-04');
      await page.getByTestId('admin-status').selectOption('cancelled');
      await page.getByTestId('admin-filter').click();
      await expect(page.getByTestId('admin-booking-row').filter({ hasText: when })).toContainText('Cancelled');
      await review('staff-filtered');
      await page.getByTestId('admin-date').fill('2030-01-01');
      await page.getByTestId('admin-filter').click();
      await expect(page.getByTestId('admin-no-bookings')).toBeVisible();
      await review('staff-empty');
      const exported = await page.request.get(
        new URL((await page.getByTestId('admin-export').getAttribute('href'))!, server.url).toString(),
      );
      expect(exported.status()).toBe(200);
      expect(await exported.text()).toContain('Patient');
      await page.goto(`${server.url}/admin?date=not-a-date`);
      await expect(page.getByTestId('admin-filter-error')).toBeVisible();
      await review('staff-invalid-filter');
      await page.getByTestId('admin-settings-link').click();
      await review('settings');
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toHaveText('Clinic settings saved.');
      await review('settings-saved');
      await page.getByTestId('admin-time-zone').fill('Not/AZone');
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-error')).toContainText('Enter a clinic name');
      await review('settings-invalid');
      await page.goto(`${server.url}/admin/settings?error=unavailable`);
      await expect(page.getByTestId('admin-settings-error')).toContainText(
        'Settings could not be saved. Please try again.',
      );
      await review('settings-unavailable');
      await page.getByTestId('sign-out').click();
      const clock = manualClock(E2E_START);
      const reset = await requestPasswordReset(
        {
          db: database.db,
          clock,
          log: captureLogs(clock).log,
          tenant: slug,
          limiter: createPasswordResetLimiter(),
          publicUrl: new URL(server.url),
          mailFrom: tenant.mailFrom,
        },
        { email: empty.email, clientIp: '192.0.2.10' },
      );
      const resetPath = /\/auth\/reset-password\/[A-Za-z0-9_-]+/.exec(reset.email?.text ?? '')![0];
      const publicStates = [
        ['visitor-home', '/'],
        ['sign-in-error', '/auth/sign-in?error=invalid'],
        ['password-changed', '/auth/sign-in?notice=password_reset'],
        ['forgot-password', '/auth/forgot-password'],
        ['forgot-sent', '/auth/forgot-password?sent=1'],
        ['invalid-reset', '/auth/reset-password/design-review-invalid-link'],
        ['new-password', resetPath],
        ['password-mismatch', `${resetPath}?error=mismatch`],
        ['password-weak', `${resetPath}?error=weak_password`],
        ['not-found', '/design-review-missing-page'],
      ];
      for (const [state, path] of publicStates) {
        await page.goto(`${server.url}${path}`);
        await review(state!);
      }
      // Only this disposable database is changed, and the table is restored even if the error review fails.
      await database.db.execute(sql`alter table password_reset_token rename to design_review_hidden_tokens`);
      try {
        await page.goto(`${server.url}/auth/reset-password/design-review-error`);
        await expect(page.getByTestId('error-page')).toHaveAttribute('role', 'alert');
        await review('error');
      } finally {
        await database.db.execute(sql`alter table design_review_hidden_tokens rename to password_reset_token`);
      }
      expect([...fontOrigins]).toEqual([new URL(server.url).origin]);
      expect(smtp.messages.length).toBeGreaterThan(0);
      for (const message of smtp.messages) {
        expect(message.raw).toContain('Content-Type: text/plain');
        expect(message.raw).not.toContain('Content-Type: text/html');
      }
    } finally {
      await server?.stop();
      await smtp.stop();
      await database.stop();
    }
  });
}
