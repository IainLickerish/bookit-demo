import { expect, test } from '@playwright/test';
import { bookings, slots } from '@/db/schema';
import { newId } from '@/lib/ids';
import { createPractitioner } from '@/server/practitioners';
import { launchServer, type RunningServer } from '../helpers/built-server';
import { seedClinic, TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { startSmtpReceiver } from '../helpers/mail';
import { E2E_START, writeClock } from './support';

test('Booking cards preserve private lists, past and late statuses, clinic-local dates, long names and the empty state', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const database = await startTestDatabase();
  const smtp = await startSmtpReceiver();
  const clock = manualClock(E2E_START);
  let server: RunningServer | undefined;
  try {
    const clinic = await seedClinic(database.db, clock, {
      settings: { timeZone: 'Pacific/Auckland' },
      extraPatients: 1,
    });
    const name = 'DémonstrationPhysiotherapistWithAnIntentionallyLongUnbrokenNameForLayoutReview';
    const practitioner = await createPractitioner(database.db, clock, {
      name,
      bio: 'Fictional layout review',
      workingDays: [1, 2, 3, 4, 5],
      workdayStart: '09:00',
      workdayEnd: '17:00',
    });
    const fixtures = [
      {
        start: '2026-12-03T11:15:00Z',
        when: 'Fri, 4 Dec 2026, 00:15',
        day: '4',
        month: 'Dec',
        status: 'confirmed',
        late: false,
      },
      {
        start: '2026-10-18T11:15:00Z',
        when: 'Mon, 19 Oct 2026, 00:15',
        day: '19',
        month: 'Oct',
        status: 'confirmed',
        late: false,
      },
      {
        start: '2026-12-04T11:15:00Z',
        when: 'Sat, 5 Dec 2026, 00:15',
        day: '5',
        month: 'Dec',
        status: 'cancelled',
        late: false,
      },
      {
        start: '2026-12-05T11:15:00Z',
        when: 'Sun, 6 Dec 2026, 00:15',
        day: '6',
        month: 'Dec',
        status: 'cancelled',
        late: true,
      },
    ] as const;
    for (const fixture of [...fixtures, { ...fixtures[0], start: '2026-12-06T11:15:00Z' }]) {
      const slotId = newId(clock);
      await database.db.insert(slots).values({
        id: slotId,
        practitionerId: practitioner.id,
        startsAt: new Date(fixture.start),
        endsAt: new Date(new Date(fixture.start).getTime() + 45 * 60_000),
        createdAt: clock.now(),
      });
      await database.db.insert(bookings).values({
        id: newId(clock),
        patientId: fixture.start === '2026-12-06T11:15:00Z' ? clinic.patient2.id : clinic.patient1.id,
        slotId,
        status: fixture.status,
        lateCancellation: fixture.late,
        phone: null,
        rescheduleCount: 0,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        cancelledAt: fixture.status === 'cancelled' ? clock.now() : null,
      });
    }
    const clockFile = info.outputPath('clock.json');
    writeClock(clockFile, E2E_START);
    server = await launchServer('.next-e2e', {
      DATABASE_URL: database.url,
      BOOKIT_TEST_CLOCK: clockFile,
      BOOKIT_TENANT: 'test',
      BOOKIT_ENV: 'local',
      BOOKIT_MAIL_FROM: 'noreply@clinic.example.test',
      BOOKIT_SMTP_URL: smtp.url,
    });
    expect(server.served).toBe(true);
    await page.goto(`${server.url}/auth/sign-in`);
    await page.getByTestId('sign-in-email').fill(clinic.patient1.email);
    await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByRole('heading', { name: 'My bookings', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Past and cancelled', exact: true })).toBeVisible();
    await expect(page.getByTestId('upcoming-bookings').getByTestId('booking-row')).toHaveCount(1);
    await expect(page.getByTestId('other-bookings').getByTestId('booking-row')).toHaveCount(3);
    await expect(page.getByTestId('booking-when').filter({ hasText: 'Mon, 7 Dec 2026' })).toHaveCount(0);
    await expect(page.locator('.card .card')).toHaveCount(0);

    for (const fixture of fixtures) {
      const row = page
        .getByTestId('booking-row')
        .filter({ has: page.getByTestId('booking-when').getByText(fixture.when, { exact: true }) });
      await expect(row).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(row).toHaveCSS('border-color', 'rgb(230, 225, 216)');
      await expect(row).toHaveCSS('border-width', '1px');
      await expect(row).toHaveCSS('border-radius', '20px');
      await expect(row).not.toHaveCSS('box-shadow', 'none');
      await expect(row.getByTestId('booking-date-tile')).toHaveCSS('background-color', 'rgb(233, 241, 236)');
      await expect(row.getByTestId('booking-date-tile')).toHaveAttribute('aria-hidden', 'true');
      await expect(row.getByTestId('booking-date-day')).toHaveText(fixture.day);
      await expect(row.getByTestId('booking-date-month')).toHaveText(fixture.month);
      await expect(row.getByTestId('booking-when')).toHaveCSS('font-variant-numeric', 'tabular-nums');
      await expect(row.getByTestId('booking-practitioner')).toHaveText(`With ${name} ·`);
      const status = row.getByTestId('booking-status');
      await expect(status).toHaveText(
        fixture.status === 'confirmed' ? 'Confirmed' : fixture.late ? 'Cancelled (late)' : 'Cancelled',
      );
      await expect(status).toHaveCSS('color', fixture.status === 'confirmed' ? 'rgb(29, 92, 75)' : 'rgb(90, 104, 98)');
      await expect(status).toHaveCSS(
        'background-color',
        fixture.status === 'confirmed' ? 'rgb(233, 241, 236)' : 'rgb(241, 238, 232)',
      );
    }
    await expect(page.getByTestId('other-bookings').getByTestId('reschedule-link')).toHaveCount(0);
    await expect(page.getByTestId('other-bookings').getByTestId('cancel-booking')).toHaveCount(0);
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 740 },
      { width: 600, height: 1200 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(
        (zoom) => {
          document.documentElement.style.zoom = zoom;
        },
        viewport.width === 600 ? '2' : '1',
      );
      const shell = page.getByTestId('my-bookings-page');
      expect(await shell.evaluate((element) => element.clientWidth)).toBeLessThanOrEqual(720);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const action of await page.getByTestId('upcoming-bookings').locator('a, button').all()) {
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByTestId('site-header').screenshot({ path: info.outputPath(`header-${viewport.width}.png`) });
      await page.screenshot({ path: info.outputPath(`bookings-${viewport.width}.png`), fullPage: true });
    }

    await page.getByTestId('sign-out').click();
    await page.goto(`${server.url}/auth/sign-in`);
    await page.getByTestId('sign-in-email').fill('extra1@patients.example.test');
    await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByTestId('booking-row')).toHaveCount(0);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(page.getByTestId('no-upcoming')).toContainText('You have no upcoming appointments.');
    await expect(page.getByTestId('no-upcoming').getByRole('link', { name: 'Book one' })).toHaveAttribute(
      'href',
      '/slots',
    );
    await expect(page.getByRole('heading', { name: 'Past and cancelled', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('empty-bookings-enlarged.png') });
  } finally {
    await server?.stop();
    await smtp.stop();
    await database.stop();
  }
});
