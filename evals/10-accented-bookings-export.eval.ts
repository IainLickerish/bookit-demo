import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookSlot,
  londonDate,
  pickFreeSlot,
  sessionFor,
  signIn,
  step,
} from './support';

test('Clinic staff can download filtered bookings with readable accented client names', async ({ browser }) => {
  const date = londonDate(32);
  const clients = [
    [PATIENT_1, 'Zoë Brontë'],
    [PATIENT_2, 'Łukasz Wiśniewski'],
    [PATIENT_3, 'Siobhán Ó Briain'],
  ] as const;
  const appointments: { name: string; when: string }[] = [];
  for (const [email, name] of clients) {
    const client = await browser.newPage();
    await step(client, `Sign in as ${name} and book a session for the export`, async () => {
      await signIn(client, email);
      const when = await bookSlot(client, (await pickFreeSlot(client, date)).id);
      appointments.push({ name, when });
    });
    await client.context().close();
  }

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Filter clinic bookings and see the three clients with their names intact', async () => {
    await staff.getByTestId('nav-admin').click();
    await staff.getByTestId('admin-date').fill(date);
    await staff.getByTestId('admin-practitioner').selectOption({ label: PRACTITIONER });
    await staff.getByTestId('admin-status').selectOption('confirmed');
    await staff.getByTestId('admin-filter').click();
    await expect(staff).toHaveURL(new RegExp(`date=${date}`));
    for (const { name, when } of appointments) {
      const row = staff.getByTestId('admin-booking-row').filter({
        has: staff.getByRole('cell', { name: when, exact: true }),
      });
      await expect(row.getByRole('cell', { name, exact: true })).toBeVisible();
      await expect(row.getByRole('cell', { name: 'Confirmed', exact: true })).toBeVisible();
    }
  });
  await step(staff, 'Download the filtered CSV and read the same accented names in it', async () => {
    const downloaded = staff.waitForEvent('download', { timeout: 10_000 });
    await staff.getByTestId('admin-export').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('bookings.csv');
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.toString('utf8');
    for (const { name } of appointments) expect(csv).toContain(`"${name}"`);
    const records = csv.split('\r\n').slice(1, -1);
    expect(records).toHaveLength(await staff.getByTestId('admin-booking-row').count());
    for (const record of records) {
      expect(record).toContain(`"${PRACTITIONER}"`);
      expect(record).toContain(`"${date}T`);
      expect(record).toContain('"confirmed"');
    }
  });
  await staff.context().close();
});
