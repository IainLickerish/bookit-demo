import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addHours } from '@/lib/time';
import { TEST_PASSWORD } from '../helpers/clinic';
import type { ReceivedMessage } from '../helpers/mail';
import { query, signIn, STATE_FILE, writeClock, type E2eState } from './support';

test.use({ trace: 'off' });

async function submitSignIn(page: Page, email: string) {
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(TEST_PASSWORD);
  await page.getByTestId('sign-in-submit').click();
}

test('Clinic staff can turn reminder emails on and off in Clinic settings', async ({ page, browser }) => {
  const [staff] = await query<{ email: string }>('select email from "user" where role = \'admin\'');
  await page.goto('/auth/sign-in');
  await submitSignIn(page, staff!.email);
  await expect(page).toHaveURL(new URL('/', page.url()).href);

  await page.goto('/admin/settings');
  const reminderSetting = page.getByRole('checkbox', { name: 'Send reminder emails' });
  await expect(reminderSetting).not.toBeChecked();
  await reminderSetting.check();
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
  await page.goto('/admin/settings');
  await expect(reminderSetting).toBeChecked();

  const patient = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await signIn(patient, 'patient1@patients.example.test');
    await patient.goto('/admin/settings');
    await expect(patient).toHaveURL(/\/bookings$/);
    await expect(patient.getByTestId('admin-reminders-enabled')).toHaveCount(0);
  } finally {
    await patient.close();
  }

  await reminderSetting.uncheck();
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
  await page.goto('/admin/settings');
  await expect(reminderSetting).not.toBeChecked();
});

test('Reminder links take the signed-in client to reschedule or cancel their own booking', async ({ page }) => {
  test.setTimeout(60_000);
  const { clockFile, mailLog, patient1, patient2 } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;
  await query('update clinic_settings set reminders_enabled = true, late_cancellation_hours = 0');
  await signIn(page, patient1);
  await page.goto('/slots?date=2026-10-21');
  const time = page.getByTestId('slot-link').first();
  const startsAt = new Date((await time.getAttribute('data-starts-at'))!);
  await time.click();
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('notice')).toBeVisible();
  const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row');
  const bookingId = await row.getAttribute('data-booking-id');
  expect(bookingId).toBeTruthy();

  writeClock(clockFile, addHours(startsAt, -24).toISOString());
  const reminder = () =>
    readFileSync(mailLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReceivedMessage)
      .find((message) => message.to.includes(patient1) && /^Subject: Reminder for your appointment/m.test(message.raw));
  await expect.poll(() => Boolean(reminder()), { timeout: 35_000 }).toBe(true);
  const body = reminder()!
    .raw.replace(/=\r?\n/g, '')
    .replaceAll('=3D', '=');
  const links = body.match(/^https?:\/\/[^\r\n]+/gm) ?? [];
  expect(links).toHaveLength(2);
  const [rescheduleLink, cancelLink] = links;

  await page.context().clearCookies();
  await page.goto(rescheduleLink!);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await submitSignIn(page, patient1);
  await expect(page).toHaveURL(new URL(`/bookings/${bookingId}/reschedule`, page.url()).href);
  await expect(page.getByTestId('current-when')).toBeVisible();

  await page.context().clearCookies();
  await page.goto(rescheduleLink!);
  await submitSignIn(page, patient2);
  await expect(page.getByTestId('not-found')).toBeVisible();
  await page.goto(cancelLink!);
  await expect(page.locator(`#booking-${bookingId}`)).toHaveCount(0);

  await page.context().clearCookies();
  await page.goto(cancelLink!);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await submitSignIn(page, patient1);
  await expect(page).toHaveURL(new URL(`/bookings#booking-${bookingId}`, page.url()).href);
  const cancel = page.locator(`#booking-${bookingId}`).getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.locator(`#booking-${bookingId}`).getByTestId('booking-status')).toHaveText('Cancelled');
});
