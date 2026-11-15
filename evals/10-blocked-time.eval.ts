import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  pickFreeSlot,
  sessionFor,
  showDay,
  step,
} from './support';

const SAVE_CRITERION =
  'Clinic staff can save a practitioner’s blocked period with an optional reason and see the result; invalid entries explain what to correct.';
const SLOTS_CRITERION =
  'Clients cannot find, book or move into overlapping slots, including from previously opened screens; other practitioners remain available.';
const WARNING_CRITERION =
  'Staff see every overlapping confirmed booking or a clear no-bookings message; existing bookings remain unchanged.';

async function fillPeriod(page: Page, start: string, end: string, reason: string) {
  await page.getByTestId('admin-blocked-time-link').click();
  await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await page.getByTestId('block-start').fill(start);
  await page.getByTestId('block-end').fill(end);
  await page.getByTestId('block-reason').fill(reason);
}

// Each journey owns a separate day, away from the existing key flows.
test(SAVE_CRITERION, async ({ browser }) => {
  const date = londonDate(41);
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Enter a blocked period with an end before its start', async () => {
    await staff.getByTestId('nav-admin').click();
    await fillPeriod(staff, `${date}T12:00`, `${date}T11:00`, 'Validation journey');
    await staff.getByTestId('block-save').click();
    await expect(staff.getByTestId('block-error')).toContainText('Correct the fields');
    await expect(staff.getByTestId('block-end-error')).toContainText('after the start');
    await expect(staff.getByTestId('block-start')).toHaveValue(`${date}T12:00`);
    await expect(staff.getByTestId('block-reason')).toHaveValue('Validation journey');
  });
  await step(staff, 'Correct the end and save without an optional reason', async () => {
    await staff.getByTestId('block-end').fill(`${date}T13:00`);
    await staff.getByTestId('block-reason').fill('');
    await staff.getByTestId('block-save').click();
    await expect(staff.getByTestId('block-saved')).toHaveText('Blocked period saved.');
  });
  await step(staff, 'Return to the saved period and see that no bookings overlap it', async () => {
    await staff.reload();
    const day = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${date}T12:00:00Z`));
    const period = staff
      .getByTestId('blocked-period')
      .filter({ has: staff.getByTestId('block-period-when').filter({ hasText: day }) });
    await expect(period).toContainText(PRACTITIONER);
    await expect(period.getByTestId('block-period-when')).toContainText('12:00');
    await expect(period.getByTestId('block-period-when')).toContainText('13:00');
    await expect(period.getByTestId('block-period-reason')).toHaveCount(0);
    await expect(period.getByTestId('block-no-bookings')).toContainText('No confirmed bookings overlap');
  });
});

test(SLOTS_CRITERION, async ({ browser }) => {
  const date = londonDate(42);
  const owner = await sessionFor(browser, PATIENT_1);
  const other = await sessionFor(browser, PATIENT_2);
  const { originalWhen, target } = await step(
    owner,
    'Book a session and leave booking and move screens open for another time',
    async () => {
      const originalWhen = await bookSlot(owner, (await pickFreeSlot(owner, date)).id);
      const target = await pickFreeSlot(other, date);
      await other.getByTestId('slot-link').filter({ hasText: target.time }).click();
      await expect(other.getByTestId('confirm-booking')).toBeVisible();
      await bookingRow(owner, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
      await owner.getByTestId('date-input').fill(date);
      await owner.getByTestId('show-slots').click();
      await expect(owner.getByTestId('reschedule-to').filter({ hasText: target.time })).toBeVisible();
      return { originalWhen, target };
    },
  );
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Block one minute inside that time, leaving neighbouring times free', async () => {
    const [hour, minute] = target.time.split(':').map(Number);
    const inside = `${String(hour).padStart(2, '0')}:${String(minute! + 1).padStart(2, '0')}`;
    const end = `${String(hour).padStart(2, '0')}:${String(minute! + 2).padStart(2, '0')}`;
    await staff.getByTestId('nav-admin').click();
    await fillPeriod(staff, `${date}T${inside}`, `${date}T${end}`, 'Stale screens journey');
    await staff.getByTestId('block-save').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
  });
  await step(other, 'Try the previously opened booking screen and see that the time is unavailable', async () => {
    await other.getByTestId('confirm-booking').click();
    await expect(other.getByTestId('booking-error')).toContainText('no longer available');
    await expect(other.getByTestId('confirm-booking')).toHaveCount(0);
    await showDay(other, date);
    await expect(other.getByTestId('slot-link').filter({ hasText: target.time })).toHaveCount(0);
    expect(await other.getByTestId('slot-link').count()).toBeGreaterThan(0);
    await other.goto('/admin/blocked-time');
    await expect(other).toHaveURL(/\/bookings$/);
    await expect(other.getByTestId('block-reason')).toHaveCount(0);
    await expect(other.getByText('Stale screens journey')).toHaveCount(0);
  });
  await step(owner, 'Try the previously opened move screen and keep the original confirmed booking', async () => {
    await owner.getByTestId('reschedule-to').filter({ hasText: target.time }).click();
    await expect(owner.getByTestId('booking-error')).toContainText('no longer available');
    await expect(owner.getByTestId('current-when')).toHaveText(originalWhen);
    await owner.getByTestId('nav-my-bookings').click();
    await expect(bookingRow(owner, 'upcoming-bookings', originalWhen).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
  });
});

test(WARNING_CRITERION, async ({ browser }) => {
  const date = londonDate(43);
  const client = await sessionFor(browser, PATIENT_1);
  const booked = await step(client, 'Book two sessions that will fall inside a blocked period', async () => {
    const first = await pickFreeSlot(client, date);
    const firstWhen = await bookSlot(client, first.id);
    const second = await pickFreeSlot(client, date);
    const secondWhen = await bookSlot(client, second.id);
    const [hours, minutes] = second.time.split(':').map(Number);
    const endMinutes = hours! * 60 + minutes! + 45;
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
    return { first, firstWhen, secondWhen, end };
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Save a blocked period covering the two confirmed sessions', async () => {
    await staff.getByTestId('nav-admin').click();
    await fillPeriod(staff, `${date}T${booked.first.time}`, `${date}T${booked.end}`, 'Affected bookings journey');
    await staff.getByTestId('block-save').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
  });
  await step(staff, 'See both affected bookings and the instruction to contact the clients', async () => {
    const period = staff
      .getByTestId('blocked-period')
      .filter({ has: staff.getByTestId('block-period-reason').filter({ hasText: 'Affected bookings journey' }) });
    await expect(period.getByTestId('block-warning')).toContainText('Contact these clients');
    await expect(period.getByTestId('block-affected-booking')).toHaveCount(2);
    for (const when of [booked.firstWhen, booked.secondWhen]) {
      const row = period.getByTestId('block-affected-booking').filter({ hasText: when });
      await expect(row).toContainText('Zoë Brontë');
      await expect(row).toContainText('Confirmed');
    }
  });
  await step(client, 'See that both original sessions remain confirmed in My bookings', async () => {
    await client.reload();
    for (const when of [booked.firstWhen, booked.secondWhen]) {
      await expect(bookingRow(client, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
    }
    await expect(client.getByText('Affected bookings journey')).toHaveCount(0);
    await expect(client.getByTestId('block-affected-booking')).toHaveCount(0);
  });
});
