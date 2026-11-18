import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { formatSlot } from '../src/lib/time';
import {
  ADMIN,
  PATIENT_1,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  pickFreeSlot,
  signIn,
  step,
} from './support';

test('Staff at both clinics download filtered bookings with accented client names', async ({ browser, baseURL }) => {
  const date = londonDate(16);
  for (const clinic of [
    {
      name: 'Acme Physio',
      url: baseURL,
      admin: ADMIN,
      patient: PATIENT_1,
      client: 'Zoë Brontë',
      practitioner: PRACTITIONER,
    },
    {
      name: 'Beacon Dental',
      url: process.env.EVAL_BEACON_BASE_URL ?? 'http://localhost:4201',
      admin: 'admin@beacondental.test',
      patient: 'patient3@patients.beacondental.test',
      client: 'Róisín Murphy',
      practitioner: 'Blair Dentist',
    },
  ]) {
    const context = await browser.newContext({ baseURL: clinic.url });
    try {
      const page = await context.newPage();
      const { bookingId, confirmedWhen, cancelledId, cancelledWhen } = await step(
        page,
        `Make a confirmed booking and a cancelled booking at ${clinic.name}`,
        async () => {
          await signIn(page, clinic.patient);
          const confirmed = await pickFreeSlot(page, date, clinic.practitioner);
          const confirmedWhen = await bookSlot(page, confirmed.id);
          const confirmedRow = bookingRow(page, 'upcoming-bookings', confirmedWhen);
          await expect(confirmedRow.getByTestId('booking-status')).toHaveText('Confirmed');
          const bookingId = await confirmedRow.getAttribute('data-booking-id');
          expect(bookingId).toBeTruthy();

          const toCancel = await pickFreeSlot(page, date, clinic.practitioner);
          const cancelledWhen = await bookSlot(page, toCancel.id);
          const cancelledRow = bookingRow(page, 'upcoming-bookings', cancelledWhen);
          const cancelledId = await cancelledRow.getAttribute('data-booking-id');
          expect(cancelledId).toBeTruthy();
          await cancelledRow.getByTestId('cancel-booking').click();
          await expect(bookingRow(page, 'other-bookings', cancelledWhen).getByTestId('booking-status')).toHaveText(
            'Cancelled',
          );
          return { bookingId, confirmedWhen, cancelledId, cancelledWhen };
        },
      );
      await page.getByTestId('sign-out').click();
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
      const listed = await step(page, `Sign in at ${clinic.name} and filter to confirmed bookings`, async () => {
        await signIn(page, clinic.admin);
        await expect(page.getByTestId('clinic-name')).toHaveText(clinic.name);
        await page.getByTestId('nav-admin').click();
        await page.getByTestId('admin-date').fill(date);
        await page.getByTestId('admin-filter').click();
        await expect(page).toHaveURL((url) => url.searchParams.get('date') === date);
        const rows = page.getByTestId('admin-booking-row');
        const cancelled = rows.filter({ hasText: cancelledWhen }).getByRole('cell', { name: 'Cancelled', exact: true });
        await expect(cancelled.first()).toBeVisible();

        await page.getByTestId('admin-status').selectOption('confirmed');
        await page.getByTestId('admin-filter').click();
        await expect(page).toHaveURL(
          (url) => url.searchParams.get('date') === date && url.searchParams.get('status') === 'confirmed',
        );
        const confirmed = rows.filter({ hasText: confirmedWhen });
        await expect(confirmed.getByRole('cell', { name: clinic.client, exact: true })).toBeVisible();
        await expect(rows.getByRole('cell', { name: 'Cancelled', exact: true })).toHaveCount(0);
        return rows.evaluateAll((bookings) =>
          bookings.map((row) => Array.from(row.querySelectorAll('td'), (cell) => cell.textContent?.trim())),
        );
      });

      await step(
        page,
        `Download the filtered file from ${clinic.name} and check that it matches the list`,
        async () => {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 10_000 }),
            page.getByTestId('admin-export').click(),
          ]);
          expect(download.suggestedFilename()).toBe('bookings.csv');
          const csv = await readFile(await download.path(), 'utf8');
          const records = csv.split('\r\n');
          expect(records.at(-1)).toBe('');
          const bookings = records.slice(1, -1).map((record) => {
            const [id, patient, practitioner, startsAt, , status] = record.slice(1, -1).split('","');
            return { id, patient, practitioner, startsAt, status };
          });
          expect(bookings).toContainEqual(expect.objectContaining({ id: bookingId, patient: clinic.client }));
          expect(bookings).not.toContainEqual(expect.objectContaining({ id: cancelledId }));
          const exported = bookings.map(({ patient, practitioner, startsAt, status }) => [
            patient,
            practitioner,
            formatSlot(new Date(startsAt ?? ''), 'Europe/London'),
            status === 'confirmed' ? 'Confirmed' : status,
          ]);
          expect(exported).toEqual(listed);
        },
      );
    } finally {
      await context.close();
    }
  }
});
