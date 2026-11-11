import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_3, PRACTITIONER, bookSlot, bookingRow, londonDate, pickFreeSlot, sessionFor } from './support';

test('A client cannot move a booking into time that staff have just blocked', async ({ browser }) => {
  const client = await sessionFor(browser, PATIENT_3);
  const admin = await sessionFor(browser, ADMIN);
  const originalDate = londonDate(25);
  const targetDate = londonDate(26);
  const original = await pickFreeSlot(client, originalDate);
  const when = await bookSlot(client, original.id);
  const reason = `Training ${randomUUID()}`;
  const block = admin.getByTestId('blocked-period').filter({ hasText: reason });
  try {
    await bookingRow(client, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
    await client.getByTestId('date-input').fill(targetDate);
    await client.getByTestId('show-slots').click();
    const target = client.getByTestId('reschedule-to').first();
    await expect(target).toBeVisible();
    const targetId = await target.getAttribute('data-slot-id');
    expect(targetId).toBeTruthy();

    // Leave the client's choices open while staff record the absence.
    await admin.goto('/admin');
    await admin.getByRole('link', { name: 'Blocked time', exact: true }).click();
    await admin.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
    await admin.getByTestId('block-start').fill(`${targetDate}T00:00`);
    await admin.getByTestId('block-end').fill(`${targetDate}T23:59`);
    await admin.getByTestId('block-reason').fill(reason);
    await admin.getByTestId('block-save').click();
    await expect(block).toBeVisible();

    await target.click();
    await expect(client.getByTestId('booking-error')).toBeVisible();
    await client.getByTestId('date-input').fill(targetDate);
    await client.getByTestId('show-slots').click();
    await expect(client.locator(`[data-testid="reschedule-to"][data-slot-id="${targetId}"]`)).toHaveCount(0);
    await client.goto('/bookings');
    await expect(bookingRow(client, 'upcoming-bookings', when)).toContainText('Confirmed');
  } finally {
    await admin.goto('/admin/blocked-time');
    if (await block.count()) await block.getByRole('button', { name: 'Remove blocked time' }).click();
    await client.goto('/bookings');
    const originalBooking = bookingRow(client, 'upcoming-bookings', when);
    if (await originalBooking.count()) await originalBooking.getByTestId('cancel-booking').click();
    await client.context().close();
    await admin.context().close();
  }
});
