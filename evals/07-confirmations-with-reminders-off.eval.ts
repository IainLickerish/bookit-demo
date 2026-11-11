import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, bookSlot, bookingRow, londonDate, mailTo, sessionFor, showDay } from './support';

test('Clients still get booking confirmation emails when staff switch appointment reminders off', async ({
  browser,
}) => {
  const staff = await sessionFor(browser, ADMIN);
  await staff.goto('/admin/settings');
  const reminders = staff.getByRole('checkbox', { name: 'Send appointment reminder emails', exact: true });
  const originallyEnabled = await reminders.isChecked();
  const client = await sessionFor(browser, PATIENT_2);
  let bookedWhen: string | undefined;
  try {
    await reminders.uncheck();
    await staff.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();
    await staff.reload();
    await expect(reminders).not.toBeChecked();

    // Find a working day without depending on which weekday the eval runs.
    for (let daysAhead = 20; daysAhead < 27; daysAhead++) {
      await showDay(client, londonDate(daysAhead));
      if (await client.getByTestId('slot-link').count()) break;
    }
    const slot = client.getByTestId('slot-link').first();
    await expect(slot).toBeVisible();
    const slotId = await slot.getAttribute('data-slot-id');
    expect(slotId).toBeTruthy();
    const before = new Set((await mailTo(PATIENT_2)).map((message) => message.ID));
    bookedWhen = await bookSlot(client, slotId!);
    await expect(bookingRow(client, 'upcoming-bookings', bookedWhen)).toBeVisible();
    await expect
      .poll(
        async () =>
          (await mailTo(PATIENT_2)).filter(
            (message) => !before.has(message.ID) && message.Subject === `Booking confirmed: ${bookedWhen}`,
          ).length,
        { timeout: 15_000 },
      )
      .toBe(1);
  } finally {
    await reminders.setChecked(originallyEnabled);
    await staff.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();
    if (bookedWhen) {
      await client.goto('/bookings');
      await bookingRow(client, 'upcoming-bookings', bookedWhen).getByTestId('cancel-booking').click();
      await expect(client).toHaveURL(/\/bookings\?notice=cancelled$/);
    }
    await client.context().close();
    await staff.context().close();
  }
});
