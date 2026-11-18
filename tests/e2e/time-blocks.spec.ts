import { eq } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { bookings, timeBlocks } from '@/db/schema';
import { newId } from '@/lib/ids';
import { bookSlot } from '@/server/bookings/book';
import { listAvailableSlots } from '@/server/slots/queries';
import { launchServer, writeClockFile } from '../helpers/built-server';
import { seedClinic, TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { startSmtpReceiver, testMail } from '../helpers/mail';

test.use({ trace: 'off' });
async function signIn(page: Page, url: string, email: string) {
  await page.goto(`${url}/auth/sign-in`);
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-out')).toBeVisible();
}

for (const tenant of ['acme', 'beacon']) {
  test(`${tenant}: staff saves a block, sees unchanged affected bookings, and clients cannot use blocked time`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const database = await startTestDatabase();
    const clock = manualClock('2026-10-20T07:00:00Z');
    const smtp = await startSmtpReceiver();
    const clinic = await seedClinic(database.db, clock, {
      settings: { clinicName: tenant === 'acme' ? 'Acme Physio' : 'Beacon Dental', slotHorizonDays: 7 },
    });
    const deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
    const slots = await listAvailableSlots(database.db, {
      practitionerId: clinic.practitioners.weekdays,
      after: new Date('2026-10-22T00:00:00Z'),
      until: new Date('2026-10-22T23:59:00Z'),
    });
    const saved = await bookSlot(deps, {
      patientId: clinic.patient1.id,
      slotId: slots[0]!.id,
      phone: '+44 7700 900001',
    });
    const before = await database.db.select().from(bookings).where(eq(bookings.id, saved.id));
    const server = await launchServer('.next-e2e', {
      DATABASE_URL: database.url,
      BOOKIT_ENV: 'local',
      BOOKIT_TENANT: tenant,
      BOOKIT_TEST_CLOCK: writeClockFile('2026-10-20T07:00:00Z'),
      BOOKIT_SMTP_URL: smtp.url,
      BOOKIT_MAIL_FROM: 'noreply@clinic.example.test',
    });
    const staffContext = await browser.newContext();
    const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      expect(server.served).toBe(true);
      const page = await staffContext.newPage();
      await signIn(page, server.url, clinic.admin.email);
      await page.goto(`${server.url}/admin`);
      await page.getByTestId('admin-time-blocks-link').click();
      await expect(page.getByTestId('time-block-practitioner')).toHaveAccessibleName(
        tenant === 'acme' ? 'Physiotherapist' : 'Clinician',
      );
      await page.getByTestId('time-block-save').click();
      await expect(page.getByTestId('time-block-error')).toHaveText(
        `Choose a ${tenant === 'acme' ? 'physiotherapist' : 'clinician'} from this clinic.`,
      );
      await page.getByTestId('time-block-practitioner').selectOption(clinic.practitioners.weekdays);
      await page.getByTestId('time-block-start').fill('2026-10-22T09:30');
      await page.getByTestId('time-block-end').fill('2026-10-22T09:00');
      await page.getByTestId('time-block-reason').fill('Training');
      await page.getByTestId('time-block-save').click();
      await expect(page.getByTestId('time-block-error')).toContainText('end must be after');
      await expect(page.getByTestId('time-block-start')).toHaveValue('2026-10-22T09:30');
      await expect(page.getByTestId('time-block-reason')).toHaveValue('Training');
      await page.getByTestId('time-block-end').fill('2026-10-22T10:30');
      await page.getByTestId('time-block-save').click();
      await expect(page.getByTestId('time-block-saved')).toHaveText('Time block saved.');
      await expect(page.getByTestId('time-block-warning')).toContainText('have not been cancelled');
      await expect(page.getByTestId('time-block-affected-booking')).toContainText(clinic.patient1.email);
      await expect(page.getByTestId('time-block-affected-booking')).toContainText('+44 7700 900001');
      await page.reload();
      await expect(page.getByTestId('time-block-saved-reason')).toHaveText('Reason: Training');
      expect(await database.db.select().from(bookings).where(eq(bookings.id, saved.id))).toEqual(before);
      // Historical blocks remain accessible without growing the first page.
      const oldClock = manualClock('2026-10-19T07:00:00Z');
      await database.db.insert(timeBlocks).values(
        Array.from({ length: 22 }, (_, index) => ({
          id: newId(oldClock),
          practitionerId: clinic.practitioners.weekdays,
          startsAt: new Date('2025-10-22T08:00:00Z'),
          endsAt: new Date('2025-10-22T09:00:00Z'),
          reason: `Historical block ${index}`,
          createdAt: oldClock.now(),
        })),
      );
      await page.goto(`${server.url}/admin?date=2026-10-22&status=confirmed`);
      await expect(page.getByTestId('time-block')).toHaveCount(20);
      const firstPage = await page.getByTestId('time-block-saved-reason').allTextContents();
      await page.getByTestId('time-block-older').click();
      await expect(page.getByTestId('time-block')).toHaveCount(3);
      const secondPage = await page.getByTestId('time-block-saved-reason').allTextContents();
      expect(secondPage.every((reason) => !firstPage.includes(reason))).toBe(true);
      await expect(page.getByTestId('admin-date')).toHaveValue('2026-10-22');
      await expect(page.getByTestId('admin-status')).toHaveValue('confirmed');
      await expect(page.getByTestId('admin-filter-error')).toHaveCount(0);
      await expect(page.getByTestId('admin-export')).toHaveAttribute(
        'href',
        '/api/admin/export?date=2026-10-22&status=confirmed',
      );
      await page.getByTestId('admin-status').selectOption('cancelled');
      await page.getByTestId('admin-filter').click();
      await expect(page.getByTestId('time-block')).toHaveCount(3);
      await expect(page.getByTestId('admin-row-count')).toHaveText('0 bookings');
      await page.getByTestId('time-block-practitioner').selectOption(clinic.practitioners.weekdays);
      await page.getByTestId('time-block-start').fill('2026-10-22T09:30');
      await page.getByTestId('time-block-end').fill('2026-10-22T10:30');
      await page.getByTestId('time-block-reason').fill('New from older page');
      await page.getByTestId('time-block-save').click();
      await expect(page.getByTestId('time-block-saved')).toHaveText('Time block saved.');
      await expect(page).not.toHaveURL(/blocksBefore=/);
      await expect(page.getByTestId('admin-date')).toHaveValue('2026-10-22');
      await expect(page.getByTestId('admin-status')).toHaveValue('cancelled');
      await expect(page.getByTestId('time-block')).toHaveCount(20);
      await expect(
        page
          .getByTestId('time-block')
          .filter({ hasText: 'New from older page' })
          .getByTestId('time-block-affected-booking'),
      ).toContainText(clinic.patient1.email);
      await page.getByTestId('time-block-older').click();
      await page.getByTestId('time-block-newest').click();
      await expect(page.getByTestId('time-block')).toHaveCount(20);
      await expect(page.getByTestId('admin-status')).toHaveValue('cancelled');
      await page.goto(`${server.url}/admin?blocksBefore=invalid`);
      await expect(page.getByTestId('time-block-page-error')).toBeVisible();
      await page.getByTestId('time-block-newest').click();
      await expect(page.getByTestId('time-block-page-error')).toHaveCount(0);
      const client = await clientContext.newPage();
      await signIn(client, server.url, clinic.patient2.email);
      await client.goto(`${server.url}/slots?practitioner=${clinic.practitioners.weekdays}&date=2026-10-22`);
      await expect(client.locator(`[data-slot-id="${slots[1]!.id}"]`)).toHaveCount(0);
      await expect(client.locator(`[data-slot-id="${slots[2]!.id}"]`)).toHaveCount(0);
      await expect(client.locator(`[data-slot-id="${slots[3]!.id}"]`)).toBeVisible();
      for (const blocked of [slots[1]!, slots[2]!]) {
        await client.goto(`${server.url}/book/${blocked.id}`);
        await expect(client.getByTestId('confirm-booking')).toHaveCount(0);
        await expect(client.getByTestId('slot-taken')).toBeVisible();
      }
      await client.goto(`${server.url}/admin`);
      await expect(client).toHaveURL(`${server.url}/bookings`);
      await expect(client.getByTestId('time-block-list')).toHaveCount(0);
    } finally {
      await staffContext.close();
      await clientContext.close();
      await server.stop();
      await smtp.stop();
      await database.stop();
    }
  });
}
