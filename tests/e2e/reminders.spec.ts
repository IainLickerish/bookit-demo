import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { query, signIn, STATE_FILE, writeClock, type E2eState } from './support';

test.use({ trace: 'off' });

test('staff control reminders and the emailed link opens only the signed-in client’s bookings', async ({
  browser,
  page,
}) => {
  test.setTimeout(100_000);
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill('admin@example.test');
  await page.getByTestId('sign-in-password').fill(state.password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/admin/settings');
  const toggle = page.getByTestId('admin-reminders-enabled');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByTestId('admin-save-settings').click();
  await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
  await page.reload();
  await expect(toggle).not.toBeChecked();

  const [slot] = await query<{ id: string }>(`select id from slot where starts_at = $1 order by id limit 1`, [
    '2026-10-21T08:00:00Z',
  ]);
  const [patient] = await query<{ id: string }>('select id from "user" where email = $1', [state.patient1]);
  const bookingId = randomUUID();
  await query(
    `insert into booking (id,patient_id,slot_id,status,late_cancellation,reschedule_count,created_at,updated_at) values ($1,$2,$3,'confirmed',false,0,$4,$4)`,
    [bookingId, patient!.id, slot!.id, '2026-10-20T07:00:00Z'],
  );
  writeClock(state.clockFile, '2026-10-20T08:00:00Z');

  const clientContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const client = await clientContext.newPage();
  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await otherContext.newPage();
  try {
    await signIn(client, state.patient1);
    await client.goto('/admin/settings');
    await expect(client).toHaveURL(/\/bookings$/);
    await expect(client.getByTestId('admin-reminders-enabled')).toHaveCount(0);
    await toggle.check();
    await page.getByTestId('admin-save-settings').click();
    await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
    await page.reload();
    await expect(toggle).toBeChecked();

    const reminders = () =>
      readFileSync(state.mailLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { raw: string; to: string[] })
        .filter((mail) => mail.raw.includes('Subject: Your appointment reminder:'));
    await expect.poll(() => reminders().length, { timeout: 70_000, intervals: [500] }).toBe(1);
    const reminder = reminders()[0]!;
    expect(reminder.to).toEqual([state.patient1]);
    const body = reminder.raw
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const link = body.match(/open My bookings: (https?:\/\/[^\s]+)/)?.[1];
    expect(link).toBe(`http://127.0.0.1:${process.env.BOOKIT_E2E_PORT ?? '4199'}/bookings`);
    await client.goto(link!);
    const row = client.locator(`[data-booking-id="${bookingId}"]`);
    await expect(row.getByTestId('cancel-booking')).toBeVisible();
    await row.getByTestId('reschedule-link').click();
    await expect(client).toHaveURL(new RegExp(`/bookings/${bookingId}/reschedule$`));
    await signIn(other, state.patient2);
    await other.goto(link!);
    await expect(other.locator(`[data-booking-id="${bookingId}"]`)).toHaveCount(0);
  } finally {
    await clientContext.close();
    await otherContext.close();
  }
});
