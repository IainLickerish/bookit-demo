import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_2,
  PRACTITIONER,
  bookSlot,
  downloadBookings,
  londonDate,
  pickFreeSlot,
  sessionFor,
  step,
} from './support';

test('The downloaded file contains exactly the filtered bookings, or just the existing column headings when none match.', async ({
  browser,
}) => {
  const date = londonDate(34);
  const client = await sessionFor(browser, PATIENT_2);
  const { when, startsAt } = await step(client, 'Book a session to find in the download', async () => {
    const slot = await pickFreeSlot(client, date);
    const startsAt = await client
      .getByTestId('slot-link')
      .filter({ hasText: slot.time })
      .getAttribute('data-starts-at');
    expect(startsAt, 'the selected session has a start time').toBeTruthy();
    return { when: await bookSlot(client, slot.id), startsAt: new Date(startsAt!).toISOString() };
  });

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Find the confirmed session using the practitioner, date and status filters', async () => {
    await staff.getByTestId('nav-admin').click();
    await staff.getByTestId('admin-practitioner').selectOption({ label: PRACTITIONER });
    await staff.getByTestId('admin-date').fill(date);
    await staff.getByTestId('admin-status').selectOption('confirmed');
    await staff.getByTestId('admin-filter').click();
    const row = staff.getByTestId('admin-booking-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell', { name: 'Łukasz Wiśniewski', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: when, exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Confirmed', exact: true })).toBeVisible();
  });

  const headings =
    '"Booking ID","Patient","Practitioner","Start (UTC)","End (UTC)","Status","Late cancellation","Phone"';
  await step(staff, 'Download the selection and see exactly that session with its original spelling', async () => {
    const csv = await downloadBookings(staff);
    const records = csv
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(records).toHaveLength(2);
    expect(records[0]).toBe(headings);
    expect(records[1]).toContain('"Łukasz Wiśniewski"');
    expect(records[1]).toContain(`"${PRACTITIONER}"`);
    expect(records[1]).toContain(`"${startsAt}"`);
    expect(records[1]).toContain('"confirmed","no"');
    await expect(staff.getByTestId('admin-booking-row')).toContainText(when);
  });

  await step(staff, 'Choose cancelled sessions and download just the headings when none match', async () => {
    await staff.getByTestId('admin-status').selectOption('cancelled');
    await staff.getByTestId('admin-filter').click();
    await expect(staff.getByTestId('admin-booking-row')).toHaveCount(0);
    await expect(staff.getByText('No bookings match these filters.', { exact: true })).toBeVisible();
    expect(await downloadBookings(staff)).toBe(`\uFEFF${headings}\r\n`);
  });
  await client.context().close();
  await staff.context().close();
});
