import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  sessionFor,
  showDay,
  step,
} from './support';

test('A late cancellation is shown as Cancelled to the client and clinic, and another client can book the time', async ({
  browser,
}) => {
  const date = londonDate(0);
  const client = await sessionFor(browser, PATIENT_3);
  const { slotId, when } = await step(
    client,
    'Book a session later today, inside the 24-hour cancellation window',
    async () => {
      await showDay(client, date);
      const slot = client.getByTestId('slot-link').filter({ hasText: '14:15' });
      await expect(slot).toBeVisible();
      const slotId = (await slot.getAttribute('data-slot-id')) ?? '';
      expect(slotId).not.toBe('');
      const when = await bookSlot(client, slotId);
      await expect(bookingRow(client, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
      return { slotId, when };
    },
  );

  await step(client, 'Cancel the session and see it in past and cancelled, away from upcoming bookings', async () => {
    await bookingRow(client, 'upcoming-bookings', when).getByTestId('cancel-booking').click();
    await expect(client.getByTestId('notice')).toContainText('Booking cancelled. This was a late cancellation.');
    await client.reload();
    await expect(bookingRow(client, 'other-bookings', when).getByTestId('booking-status')).toHaveText(
      'Cancelled (late)',
    );
    await expect(bookingRow(client, 'upcoming-bookings', when)).toHaveCount(0);
  });

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Find the cancelled session in Clinic bookings', async () => {
    await staff.getByTestId('nav-admin').click();
    await staff.getByTestId('admin-date').fill(date);
    await staff.getByTestId('admin-practitioner').selectOption({ label: PRACTITIONER });
    await staff.getByTestId('admin-filter').click();
    const row = staff
      .getByTestId('admin-booking-row')
      .filter({ hasText: 'Siobhán Ó Briain' })
      .filter({ hasText: when });
    await expect(row.getByRole('cell', { name: when, exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Cancelled (late)', exact: true })).toBeVisible();
  });

  const other = await sessionFor(browser, PATIENT_2);
  await step(other, 'Choose the freed time and complete a booking as another client', async () => {
    await showDay(other, date);
    const slot = other.getByTestId('slot-link').filter({ hasText: '14:15' });
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('data-slot-id', slotId);
    await slot.click();
    await expect(other.getByTestId('book-when')).toContainText(when);
    await other.getByTestId('confirm-booking').click();
    await expect(other.getByTestId('notice')).toContainText('Booking confirmed.');
    await other.reload();
    await expect(bookingRow(other, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
  });
});
