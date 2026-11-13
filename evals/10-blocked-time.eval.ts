import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  givePhone,
  londonDate,
  pickFreeSlot,
  sessionFor,
  showDay,
  slotOffered,
  step,
} from './support';

async function reviewBlock(page: Page, date: string, start: string, end: string, reason: string) {
  await page.goto('/admin');
  await page.getByTestId('admin-blocked-time-link').click();
  await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await page.getByTestId('block-start').fill(`${date}T${start}`);
  await page.getByTestId('block-end').fill(`${date}T${end}`);
  await page.getByTestId('block-reason').fill(reason);
  await page.getByTestId('block-review').click();
  await expect(page.getByTestId('block-preview')).toBeVisible();
}

// Distinct days keep these saved blocks away from the other owner journeys.
test('Staff can review affected bookings before confirming a practitioner’s blocked time.', async ({ browser }) => {
  const date = londonDate(23);
  const client = await sessionFor(browser, PATIENT_1);
  const when = await step(client, 'Book a session that staff will need to cancel', async () => {
    return bookSlot(client, (await pickFreeSlot(client, date)).id);
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Review the blocked day and its affected session', async () => {
    await reviewBlock(staff, date, '09:00', '17:00', 'Training day');
    await expect(staff.getByTestId('block-affected-booking').filter({ hasText: 'Zoë Brontë' })).toContainText(when);
    await expect(staff.getByTestId('block-impact')).toContainText('will be cancelled');
    await client.reload();
    await expect(bookingRow(client, 'upcoming-bookings', when)).toContainText('Confirmed');
  });
  await step(staff, 'Go back with the details retained, then confirm the cancellation', async () => {
    await staff.getByTestId('block-edit').click();
    await expect(staff.getByTestId('block-reason')).toHaveValue('Training day');
    await staff.getByTestId('block-review').click();
    await staff.getByTestId('block-confirm').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
    await expect(staff.getByTestId('block-cancelled-booking').filter({ hasText: 'Zoë Brontë' })).toContainText(
      'Cancelled',
    );
    await client.reload();
    await expect(bookingRow(client, 'other-bookings', when)).toContainText('Cancelled');
  });
  await step(staff, 'Reopen the saved block and see its cancellations', async () => {
    await staff.goto('/admin/blocked-time');
    await staff.getByTestId('block-list-row').filter({ hasText: 'Training day' }).getByTestId('block-open').click();
    await expect(staff.getByTestId('block-detail')).toContainText(when);
    await expect(staff.getByTestId('block-detail')).toContainText('Training day');
  });
  await step(client, 'Check that clients and visitors cannot view the clinic’s blocked-time page', async () => {
    await client.goto(staff.url());
    await expect(client).toHaveURL(/\/bookings$/);
    await expect(client.getByTestId('block-detail')).toHaveCount(0);
    await client.getByTestId('sign-out').click();
    await client.goto('/admin/blocked-time');
    await expect(client).toHaveURL(/\/auth\/sign-in$/);
  });
});

test('Changed affected bookings require another review before anything is saved.', async ({ browser }) => {
  const date = londonDate(24);
  const client = await sessionFor(browser, PATIENT_2);
  const free = await step(client, 'Choose a free session without booking it yet', async () =>
    pickFreeSlot(client, date),
  );
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Review a blocked day with no affected bookings', async () => {
    await reviewBlock(staff, date, '09:00', '17:00', 'Changed impact check');
    await expect(staff.getByTestId('block-impact')).toContainText('No confirmed sessions overlap');
  });
  const when = await step(client, 'Book a session after staff have reviewed the day', async () =>
    bookSlot(client, free.id),
  );
  await step(staff, 'Try to confirm and see that a new review is required', async () => {
    await staff.getByTestId('block-confirm').click();
    await expect(staff.getByTestId('block-error')).toContainText('Review the details again');
    await expect(staff.getByTestId('block-reason')).toHaveValue('Changed impact check');
    await expect(staff.getByTestId('block-list-row').filter({ hasText: 'Changed impact check' })).toHaveCount(0);
    await client.reload();
    await expect(bookingRow(client, 'upcoming-bookings', when)).toContainText('Confirmed');
  });
  await step(staff, 'Review the new impact, then save both the block and cancellation', async () => {
    await staff.getByTestId('block-review').click();
    await expect(staff.getByTestId('block-affected-booking').filter({ hasText: 'Łukasz Wiśniewski' })).toContainText(
      when,
    );
    await staff.getByTestId('block-confirm').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
    await client.reload();
    await expect(bookingRow(client, 'other-bookings', when)).toContainText('Cancelled');
  });
});

test('Blocked slots cannot be booked or used for moves, including requests made from an earlier screen.', async ({
  browser,
}) => {
  const date = londonDate(25);
  const mover = await sessionFor(browser, PATIENT_1);
  const { originalWhen, targetId } = await step(
    mover,
    'Book a session and prepare to move it to the following day',
    async () => {
      const originalWhen = await bookSlot(mover, (await pickFreeSlot(mover, londonDate(26))).id);
      await bookingRow(mover, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
      await mover.getByTestId('date-input').fill(date);
      await mover.getByTestId('show-slots').click();
      const targetId = (await mover.getByTestId('reschedule-to').first().getAttribute('data-slot-id'))!;
      return { originalWhen, targetId };
    },
  );
  const client = await sessionFor(browser, PATIENT_2);
  await step(client, 'Open the same free time on the booking confirmation screen', async () => {
    await client.goto(`/book/${targetId}`);
    await givePhone(client);
    await expect(client.getByTestId('confirm-booking')).toBeVisible();
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Block the day before either client confirms', async () => {
    await reviewBlock(staff, date, '09:00', '17:00', 'Time away');
    await staff.getByTestId('block-confirm').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
    await expect(staff.getByTestId('block-no-cancellations')).toBeVisible();
  });
  await step(mover, 'Try both earlier choices and see that the original booking is kept', async () => {
    await Promise.all([
      mover.locator(`[data-testid="reschedule-to"][data-slot-id="${targetId}"]`).click(),
      client.getByTestId('confirm-booking').click(),
    ]);
    await expect(mover.getByTestId('booking-error')).toContainText('no longer available');
    await expect(client.getByTestId('booking-error')).toContainText('no longer available');
    await mover.getByTestId('nav-my-bookings').click();
    await expect(bookingRow(mover, 'upcoming-bookings', originalWhen)).toContainText('Confirmed');
    expect(await slotOffered(client, date, targetId)).toBe(false);
    await showDay(client, date);
    await expect(client.getByTestId('no-slots')).toBeVisible();
  });
});
