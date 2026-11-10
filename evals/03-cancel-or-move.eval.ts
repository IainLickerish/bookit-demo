import { expect, test } from '@playwright/test';
import {
  PATIENT_2,
  PATIENT_3,
  bookSlot,
  bookingRow,
  londonDate,
  pickFreeSlot,
  sessionFor,
  slotOffered,
} from './support';

test('A client can move and cancel their own booking, and the old time becomes free again', async ({ browser }) => {
  const date = londonDate(13);
  const page = await sessionFor(browser, PATIENT_3);
  const original = await pickFreeSlot(page, date);
  const originalWhen = await bookSlot(page, original.id);
  const other = await sessionFor(browser, PATIENT_2);

  // Move it to another free time on the same day.
  await bookingRow(page, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
  await page.getByTestId('date-input').fill(date);
  await page.getByTestId('show-slots').click();
  const target = page.getByTestId('reschedule-to').first();
  const movedId = (await target.getAttribute('data-slot-id')) ?? '';
  const movedWhen = ((await target.textContent()) ?? '').trim();
  await target.click();
  await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
  await expect(bookingRow(page, 'upcoming-bookings', movedWhen)).toBeVisible();
  expect(await slotOffered(other, date, original.id), 'the old time is free again after the move').toBe(true);
  expect(await slotOffered(other, date, movedId), 'the new time is taken').toBe(false);

  // Cancel it.
  await page.getByTestId('nav-my-bookings').click();
  await bookingRow(page, 'upcoming-bookings', movedWhen).getByTestId('cancel-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
  await expect(bookingRow(page, 'other-bookings', movedWhen).getByTestId('booking-status')).toHaveText('Cancelled');
  expect(await slotOffered(other, date, movedId), 'the cancelled time is free again').toBe(true);
});
