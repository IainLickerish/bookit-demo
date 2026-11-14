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
  step,
} from './support';

test('A client can move and cancel their own booking, and the old time becomes free again', async ({ browser }) => {
  const date = londonDate(13);
  const page = await sessionFor(browser, PATIENT_3);
  const { original, originalWhen } = await step(page, 'Book a free session', async () => {
    const original = await pickFreeSlot(page, date);
    const originalWhen = await bookSlot(page, original.id);
    return { original, originalWhen };
  });
  const other = await sessionFor(browser, PATIENT_2);

  const { movedId, movedWhen } = await step(page, 'Move the session to another free time on the same day', async () => {
    await bookingRow(page, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
    await page.getByTestId('date-input').fill(date);
    await page.getByTestId('show-slots').click();
    const target = page.getByTestId('reschedule-to').first();
    const movedId = (await target.getAttribute('data-slot-id')) ?? '';
    const movedWhen = ((await target.textContent()) ?? '').trim();
    await target.click();
    await expect(page.getByTestId('review-new')).toContainText(movedWhen);
    await page.getByTestId('confirm-change').click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    await expect(bookingRow(page, 'upcoming-bookings', movedWhen)).toBeVisible();
    return { movedId, movedWhen };
  });
  await step(other, 'See that the old time is free and the new time is taken', async () => {
    expect(await slotOffered(other, date, original.id), 'the old time is free again after the move').toBe(true);
    expect(await slotOffered(other, date, movedId), 'the new time is taken').toBe(false);
  });

  await step(page, 'Cancel the session and see its cancelled status', async () => {
    await page.getByTestId('nav-my-bookings').click();
    await bookingRow(page, 'upcoming-bookings', movedWhen).getByTestId('cancel-booking').click();
    await expect(page.getByTestId('review-current')).toContainText(movedWhen);
    await page.getByTestId('confirm-change').click();
    await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
    await expect(bookingRow(page, 'other-bookings', movedWhen).getByTestId('booking-status')).toHaveText('Cancelled');
  });
  await step(other, 'See that the cancelled time is free again', async () => {
    expect(await slotOffered(other, date, movedId), 'the cancelled time is free again').toBe(true);
  });
});
