import { eq } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { bookings } from '@/db/schema';
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
