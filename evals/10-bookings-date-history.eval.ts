import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, bookSlot, pickFreeSlot, sessionFor, step } from './support';

test('Browser Back restores 15 November in the date field and its bookings after filtering 14 November', async ({
  browser,
}) => {
  const client = await sessionFor(browser, PATIENT_1);
  const booked = await step(client, 'Book a session on 15 November and another on 14 November', async () => {
    const fifteenth = await bookSlot(client, (await pickFreeSlot(client, '2026-11-15')).id);
    const fourteenth = await bookSlot(client, (await pickFreeSlot(client, '2026-11-14')).id);
    return { fifteenth, fourteenth };
  });

  const staff = await sessionFor(browser, ADMIN);
  const rows = staff.getByTestId('admin-booking-row');
  const fifteenthRow = rows.filter({ has: staff.getByRole('cell', { name: booked.fifteenth, exact: true }) });
  const fourteenthRow = rows.filter({ has: staff.getByRole('cell', { name: booked.fourteenth, exact: true }) });

  await step(staff, 'Open Clinic bookings with no date filter and see both sessions', async () => {
    await staff.getByTestId('nav-admin').click();
    await expect(staff.getByTestId('admin-date')).toHaveValue('');
    await expect(fifteenthRow).toContainText('Zoë Brontë');
    await expect(fourteenthRow).toContainText('Zoë Brontë');
  });

  await step(staff, 'Filter bookings to 15 November', async () => {
    await staff.getByTestId('admin-date').fill('2026-11-15');
    await staff.getByTestId('admin-filter').click();
    await expect(staff).toHaveURL(/[?&]date=2026-11-15(?:&|$)/);
    await expect(staff.getByTestId('admin-date')).toHaveValue('2026-11-15');
    await expect(fifteenthRow).toBeVisible();
    await expect(fourteenthRow).toHaveCount(0);
  });

  await step(staff, 'Filter bookings to 14 November', async () => {
    await staff.getByTestId('admin-date').fill('2026-11-14');
    await staff.getByTestId('admin-filter').click();
    await expect(staff).toHaveURL(/[?&]date=2026-11-14(?:&|$)/);
    await expect(staff.getByTestId('admin-date')).toHaveValue('2026-11-14');
    await expect(fourteenthRow).toBeVisible();
    await expect(fifteenthRow).toHaveCount(0);
  });

  await step(staff, 'Go Back and see 15 November in the address, date field and bookings', async () => {
    await staff.goBack();
    await expect(staff).toHaveURL(/[?&]date=2026-11-15(?:&|$)/);
    await expect(fifteenthRow).toContainText('Zoë Brontë');
    await expect(fourteenthRow).toHaveCount(0);
    for (const row of await rows.all()) {
      await expect(row.getByRole('cell').filter({ hasText: /Nov 2026/ })).toContainText('15 Nov 2026');
    }
    await expect(staff.getByTestId('admin-date')).toHaveValue('2026-11-15');
  });

  await step(staff, 'Clear the filters and see both sessions again', async () => {
    await staff.getByRole('link', { name: 'Clear filters', exact: true }).click();
    await expect(staff).toHaveURL(/\/admin$/);
    await expect(staff.getByTestId('admin-date')).toHaveValue('');
    await expect(staff.getByTestId('admin-practitioner')).toHaveValue('');
    await expect(staff.getByTestId('admin-status')).toHaveValue('');
    await expect(fifteenthRow).toContainText('Zoë Brontë');
    await expect(fourteenthRow).toContainText('Zoë Brontë');
  });
  await client.context().close();
  await staff.context().close();
});
