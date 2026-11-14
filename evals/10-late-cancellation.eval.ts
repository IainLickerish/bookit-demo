import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PATIENT_3,
  bookSlot,
  bookingRow,
  givePhone,
  londonDate,
  pickLateSlot,
  sessionFor,
  showDay,
  step,
} from './support';

test('Cancelling an upcoming booking inside the late window shows success and moves it to Past and cancelled as Cancelled (late), including after refreshing.', async ({
  browser,
}) => {
  const client = await sessionFor(browser, PATIENT_1);
  const when = await step(client, 'Book a free session inside the late window', async () => {
    const when = await bookSlot(client, await pickLateSlot(client, '13:30'));
    await expect(bookingRow(client, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
    return when;
  });

  await step(client, 'Cancel the session and see success with its late-cancelled status', async () => {
    await bookingRow(client, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(client.getByTestId('notice')).toContainText('Booking cancelled. This was a late cancellation.');
    await expect(bookingRow(client, 'other-bookings', when).getByTestId('booking-status')).toHaveText(
      'Cancelled (late)',
    );
    await expect(bookingRow(client, 'upcoming-bookings', when)).toHaveCount(0);
  });

  await step(client, 'Refresh My bookings and see the session still in Past and cancelled', async () => {
    await client.reload();
    await expect(client.getByRole('heading', { name: 'Past and cancelled', exact: true })).toBeVisible();
    await expect(bookingRow(client, 'other-bookings', when).getByTestId('booking-status')).toHaveText(
      'Cancelled (late)',
    );
    await expect(bookingRow(client, 'upcoming-bookings', when)).toHaveCount(0);
  });

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Find the same session marked Cancelled (late) in Clinic bookings', async () => {
    await staff.getByTestId('nav-admin').click();
    await staff.getByTestId('admin-date').fill(londonDate(0));
    await staff.getByTestId('admin-filter').click();
    const row = staff
      .getByTestId('admin-booking-row')
      .filter({ has: staff.getByRole('cell', { name: when, exact: true }) });
    await expect(row.getByRole('cell', { name: 'Zoë Brontë', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Cancelled (late)', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Confirmed', exact: true })).toHaveCount(0);
  });
});

test('Another client can book the released time, while two clients cannot both book it.', async ({ browser }) => {
  const owner = await sessionFor(browser, PATIENT_1);
  const second = await sessionFor(browser, PATIENT_2);
  const third = await sessionFor(browser, PATIENT_3);
  const { slotId, when } = await step(owner, 'Book a different free session inside the late window', async () => {
    const slotId = await pickLateSlot(owner, '14:15');
    return { slotId, when: await bookSlot(owner, slotId) };
  });

  await step(owner, 'Cancel that session to release its time', async () => {
    await bookingRow(owner, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(owner.getByTestId('notice')).toContainText('Booking cancelled. This was a late cancellation.');
  });

  await step(second, 'Find the released time as two other clients and open it for booking', async () => {
    for (const client of [second, third]) {
      await showDay(client, londonDate(0));
      const released = client.getByTestId('slot-link').filter({ hasText: when });
      await expect(released).toBeVisible();
      await released.click();
      await givePhone(client);
      await expect(client.getByTestId('confirm-booking')).toBeVisible();
    }
  });

  await step(second, 'Both clients confirm at once and exactly one gets the session', async () => {
    await Promise.all([second.getByTestId('confirm-booking').click(), third.getByTestId('confirm-booking').click()]);
    for (const client of [second, third]) {
      await expect(client).toHaveURL((url) =>
        url.pathname === '/bookings'
          ? url.searchParams.get('notice') === 'booked'
          : url.searchParams.get('error') === 'slot_unavailable',
      );
    }
    const winners = [second, third].filter((client) => new URL(client.url()).searchParams.get('notice') === 'booked');
    expect(winners, 'exactly one of the other clients booked the released time').toHaveLength(1);
    const loser = winners[0] === second ? third : second;
    await expect(loser.getByTestId('booking-error')).toContainText('Please choose another');
    await expect(loser.getByTestId('notice')).toHaveCount(0);
  });

  await step(second, 'Refresh both clients’ bookings and see just one confirmed session at that time', async () => {
    for (const client of [second, third]) await client.goto('/bookings');
    const confirmed = await Promise.all(
      [second, third].map((client) => bookingRow(client, 'upcoming-bookings', when).count()),
    );
    expect(confirmed.sort()).toEqual([0, 1]);
    await second.goto(`/book/${slotId}`);
    await expect(second.getByTestId('confirm-booking')).toHaveCount(0);
  });
});
