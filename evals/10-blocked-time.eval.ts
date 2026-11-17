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
  step,
} from './support';

async function saveBlock(page: Page, date: string, start: string, end: string, reason: string) {
  await page.goto('/admin');
  await page.getByTestId('admin-blocks-link').click();
  await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await page.getByTestId('block-start').fill(`${date}T${start}`);
  await page.getByTestId('block-end').fill(`${date}T${end}`);
  await page.getByTestId('block-reason').fill(reason);
  await page.getByTestId('block-save').click();
  await expect(page.getByTestId('block-saved')).toHaveText('Blocked time saved.');
}

const displayed = (date: string, time: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(`${date}T${time}:00Z`));

test('Staff can save and read blocked periods with and without a reason', async ({ browser }) => {
  const staff = await sessionFor(browser, ADMIN);
  const date = londonDate(41);
  await step(staff, 'Save a blocked period with a reason', async () => {
    await saveBlock(staff, date, '09:15', '10:15', 'Blocked-time check: staff training');
  });
  await step(staff, 'Reload and read the saved practitioner, start, end and reason', async () => {
    await staff.reload();
    const row = staff.getByTestId('block-row').filter({ hasText: 'Blocked-time check: staff training' });
    await expect(row.getByTestId('block-name')).toHaveText(PRACTITIONER);
    await expect(row.getByTestId('block-period')).toContainText(displayed(date, '09:15'));
    await expect(row.getByTestId('block-period')).toContainText(displayed(date, '10:15'));
    await expect(row.getByTestId('block-saved-reason')).toHaveText('Blocked-time check: staff training');
  });
  await step(staff, 'Save another period leaving the optional reason empty', async () => {
    await saveBlock(staff, date, '11:15', '12:15', '');
  });
  await step(staff, 'Reload and read the period saved without a reason', async () => {
    await staff.reload();
    const row = staff.getByTestId('block-row').filter({ hasText: displayed(date, '11:15') });
    await expect(row.getByTestId('block-name')).toHaveText(PRACTITIONER);
    await expect(row.getByTestId('block-period')).toContainText(displayed(date, '12:15'));
    await expect(row.getByTestId('block-saved-reason')).toHaveText('No reason given.');
  });
});

test('Staff see both overlapping confirmed bookings after blocking time and both clients keep their bookings', async ({
  browser,
}) => {
  const date = londonDate(42);
  const a = await sessionFor(browser, PATIENT_1);
  const b = await sessionFor(browser, PATIENT_2);
  const first = await step(a, 'Book a session as the first client', async () => {
    const slot = await pickFreeSlot(a, date);
    return { slot, when: await bookSlot(a, slot.id) };
  });
  const second = await step(b, 'Book another session as the second client', async () => {
    const slot = await pickFreeSlot(b, date);
    return { slot, when: await bookSlot(b, slot.id) };
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Block the day and read the warning listing both bookings', async () => {
    await saveBlock(staff, date, '00:00', '23:59', 'Blocked-time check: existing bookings');
    const warning = staff
      .getByTestId('block-row')
      .filter({ hasText: 'Blocked-time check: existing bookings' })
      .getByTestId('block-warning');
    await expect(warning).toContainText('No bookings have been cancelled.');
    const firstRow = warning.getByTestId('block-affected-booking').filter({ hasText: 'Zoë Brontë' });
    await expect(firstRow).toContainText(first.when);
    await expect(firstRow).toContainText('Confirmed');
    const secondRow = warning.getByTestId('block-affected-booking').filter({ hasText: 'Łukasz Wiśniewski' });
    await expect(secondRow).toContainText(second.when);
    await expect(secondRow).toContainText('Confirmed');
  });
  await step(a, 'See that the first client still has the same confirmed booking', async () => {
    await a.reload();
    const row = bookingRow(a, 'upcoming-bookings', first.when);
    await expect(row).toContainText(PRACTITIONER);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  });
  await step(b, 'See that the second client still has the same confirmed booking', async () => {
    await b.reload();
    const row = bookingRow(b, 'upcoming-bookings', second.when);
    await expect(row).toContainText(PRACTITIONER);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  });
});

test('A saved block removes overlapping choices and refuses booking and moving from pages opened before it was saved', async ({
  browser,
}) => {
  const date = londonDate(43);
  const client = await sessionFor(browser, PATIENT_1);
  const original = await step(client, 'Book a session to move later', async () => {
    const slot = await pickFreeSlot(client, date);
    return { slot, when: await bookSlot(client, slot.id) };
  });
  const staleBooker = await sessionFor(browser, PATIENT_2);
  const target = await step(staleBooker, 'Open a free time ready to confirm a booking', async () => {
    const slot = await pickFreeSlot(staleBooker, date);
    await staleBooker.goto(`/book/${slot.id}`);
    await givePhone(staleBooker);
    await expect(staleBooker.getByTestId('confirm-booking')).toBeVisible();
    return slot;
  });
  await step(client, 'Open the move page while that target time is still available', async () => {
    await bookingRow(client, 'upcoming-bookings', original.when).getByTestId('reschedule-link').click();
    await client.getByTestId('date-input').fill(date);
    await client.getByTestId('show-slots').click();
    await expect(client.locator(`[data-testid="reschedule-to"][data-slot-id="${target.id}"]`)).toBeVisible();
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Save a block overlapping part of the chosen target time', async () => {
    const [hour, minute] = target.time.split(':').map(Number) as [number, number];
    const endMinutes = hour * 60 + minute + 5;
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
    await saveBlock(staff, date, target.time, end, 'Blocked-time check: stale pages');
  });
  await step(staleBooker, 'Confirm on the old booking page and see that the time is refused', async () => {
    await staleBooker.getByTestId('confirm-booking').click();
    await expect(staleBooker.getByTestId('booking-error')).toContainText('that time is no longer available');
    await expect(staleBooker.getByTestId('confirm-booking')).toHaveCount(0);
  });
  await step(client, 'Try the old move choice and keep the original confirmed booking', async () => {
    await client.locator(`[data-testid="reschedule-to"][data-slot-id="${target.id}"]`).click();
    await expect(client.getByTestId('booking-error')).toContainText('that time is no longer available');
    await expect(client.getByTestId('current-when')).toHaveText(original.when);
    await expect(client.locator(`[data-testid="reschedule-to"][data-slot-id="${target.id}"]`)).toHaveCount(0);
    await client.getByTestId('nav-my-bookings').click();
    await expect(bookingRow(client, 'upcoming-bookings', original.when).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
  });
  await step(staleBooker, 'See that a fresh availability search also excludes the blocked time', async () => {
    await showDay(staleBooker, date);
    await expect(staleBooker.locator(`[data-testid="slot-link"][data-slot-id="${target.id}"]`)).toHaveCount(0);
    await expect(staleBooker.getByTestId('slot-link').first()).toBeVisible();
  });
});
