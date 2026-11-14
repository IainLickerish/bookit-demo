import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PATIENT_3,
  bookSlot,
  evalNow,
  givePhone,
  londonDate,
  showDay,
  signIn,
  slotOffered,
  step,
} from './support';

const clientRow = (page: Page, list: 'upcoming-bookings' | 'other-bookings', when: string) =>
  page
    .getByTestId(list)
    .getByTestId('booking-row')
    .filter({ has: page.getByText(when, { exact: true }) });
const clinicRow = (page: Page, when: string) =>
  page.getByTestId('admin-booking-row').filter({ has: page.getByRole('cell', { name: when, exact: true }) });

async function bookLateSession(page: Page, time: string) {
  const date = londonDate(0);
  await showDay(page, date);
  // Each journey owns a different named time on the fixed demo day.
  const slot = page.getByTestId('slot-link').filter({ hasText: new RegExp(`, ${time}$`) });
  await expect(slot).toBeVisible();
  const startsAt = Date.parse((await slot.getAttribute('data-starts-at'))!);
  expect(startsAt - evalNow().getTime()).toBeGreaterThan(0);
  expect(startsAt - evalNow().getTime()).toBeLessThan(24 * 3_600_000);
  const id = (await slot.getAttribute('data-slot-id'))!;
  const when = await bookSlot(page, id);
  await expect(clientRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
  return { id, date, when };
}

async function cancelLate(page: Page, when: string) {
  await page.goto('/bookings');
  await clientRow(page, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
  await expect(page.getByTestId('notice')).toHaveText('Booking cancelled. This was a late cancellation.');
  await expect(clientRow(page, 'other-bookings', when).getByTestId('booking-status')).toHaveText('Cancelled (late)');
  await expect(clientRow(page, 'upcoming-bookings', when)).toHaveCount(0);
}

async function filterClinic(page: Page, date: string, status: 'confirmed' | 'cancelled') {
  await page.goto('/admin');
  await page.getByTestId('admin-date').fill(date);
  await page.getByTestId('admin-status').selectOption(status);
  await page.getByTestId('admin-filter').click();
}

test('The same clinic’s staff see that booking as “Cancelled (late)”, included under the Cancelled filter and excluded from Confirmed.', async ({
  page,
  browser,
}) => {
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  try {
    const booking = await step(page, 'Sign in and book a session later today', async () => {
      await signIn(page, PATIENT_1);
      return bookLateSession(page, '14:15');
    });
    await step(page, 'Cancel inside the late window and see the session in Past and cancelled', async () => {
      await cancelLate(page, booking.when);
    });
    await step(page, 'Reload My bookings and see that the late cancellation is saved', async () => {
      await page.reload();
      await expect(page.getByTestId('notice')).toContainText('late cancellation');
      await expect(clientRow(page, 'other-bookings', booking.when).getByTestId('booking-status')).toHaveText(
        'Cancelled (late)',
      );
      await expect(clientRow(page, 'other-bookings', booking.when).getByTestId('cancel-booking')).toHaveCount(0);
      await expect(clientRow(page, 'upcoming-bookings', booking.when)).toHaveCount(0);
    });
    await step(staff, 'Sign in as staff and find the session under Cancelled', async () => {
      await signIn(staff, ADMIN);
      await filterClinic(staff, booking.date, 'cancelled');
      await expect(
        clinicRow(staff, booking.when).getByRole('cell', { name: 'Cancelled (late)', exact: true }),
      ).toBeVisible();
      await staff.reload();
      await expect(
        clinicRow(staff, booking.when).getByRole('cell', { name: 'Cancelled (late)', exact: true }),
      ).toBeVisible();
    });
    await step(staff, 'See that the cancelled session is absent from Confirmed', async () => {
      await filterClinic(staff, booking.date, 'confirmed');
      await expect(clinicRow(staff, booking.when)).toHaveCount(0);
    });
  } finally {
    await staffContext.close();
  }
});

test('Another client is offered the released time and can book it; if two clients try together, only one receives a confirmed booking.', async ({
  page,
  browser,
}) => {
  const secondContext = await browser.newContext();
  const thirdContext = await browser.newContext();
  const second = await secondContext.newPage();
  const third = await thirdContext.newPage();
  try {
    const booking = await step(page, 'Sign in and book a different session later today', async () => {
      await signIn(page, PATIENT_1);
      return bookLateSession(page, '15:00');
    });
    await step(page, 'Cancel the session late and see its cancelled status', async () => {
      await cancelLate(page, booking.when);
    });
    await step(second, 'Two other clients see the released time and open its booking form', async () => {
      for (const [client, email] of [
        [second, PATIENT_2],
        [third, PATIENT_3],
      ] as const) {
        await signIn(client, email);
        expect(await slotOffered(client, booking.date, booking.id)).toBe(true);
        await client.goto(`/book/${booking.id}`);
        await givePhone(client);
        await expect(client.getByTestId('confirm-booking')).toBeVisible();
      }
    });
    await step(second, 'Confirm together and see one booking and one explanation that the time has gone', async () => {
      await Promise.all([second, third].map((client) => client.getByTestId('confirm-booking').click()));
      for (const client of [second, third]) {
        await expect(client).toHaveURL(/\/bookings\?notice=booked$|\?error=slot_unavailable$/);
      }
      const winners = [second, third].filter((client) => client.url().endsWith('/bookings?notice=booked'));
      expect(winners).toHaveLength(1);
      const winner = winners[0]!;
      await expect(clientRow(winner, 'upcoming-bookings', booking.when).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
      const loser = winner === second ? third : second;
      await expect(loser.getByTestId('booking-error')).toContainText('Please choose another.');
      await loser.goto('/bookings');
      await expect(clientRow(loser, 'upcoming-bookings', booking.when)).toHaveCount(0);
    });
    await step(page, 'See that the replacement takes the time while the original stays cancelled', async () => {
      expect(await slotOffered(page, booking.date, booking.id)).toBe(false);
      await page.goto('/bookings');
      await expect(clientRow(page, 'other-bookings', booking.when).getByTestId('booking-status')).toHaveText(
        'Cancelled (late)',
      );
    });
  } finally {
    await secondContext.close();
    await thirdContext.close();
  }
});
