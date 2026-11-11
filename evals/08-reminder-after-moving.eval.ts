import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_3,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  mailTo,
  pickFreeSlot,
  sessionFor,
} from './support';

test('A client who moves an appointment to the next 24 hours gets a reminder with the new time and booking links', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const staff = await sessionFor(browser, ADMIN);
  await staff.goto('/admin/settings');
  const reminders = staff.getByRole('checkbox', { name: 'Send appointment reminder emails', exact: true });
  const originallyEnabled = await reminders.isChecked();
  const client = await sessionFor(browser, PATIENT_3);
  let bookingId: string | null = null;
  let originalSlot: string | undefined;
  try {
    await reminders.uncheck();
    await staff.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();

    const original = await pickFreeSlot(client, londonDate(30));
    originalSlot = original.id;
    const originalWhen = await bookSlot(client, original.id);
    const row = bookingRow(client, 'upcoming-bookings', originalWhen);
    bookingId = await row.getAttribute('data-booking-id');
    await row.getByTestId('reschedule-link').click();

    let movedWhen: string | undefined;
    // The demo clinic opens every day. Select a time safely inside the
    // reminder window using the same date picker a client uses.
    // eslint-disable-next-line no-restricted-syntax -- the demo uses the real clock
    const now = Date.now();
    for (const daysAhead of [0, 1]) {
      await client.getByTestId('date-input').fill(londonDate(daysAhead));
      await client.getByTestId('show-slots').click();
      for (const target of await client.getByTestId('reschedule-to').all()) {
        const startsAt = Date.parse((await target.getAttribute('data-starts-at')) ?? '');
        if (startsAt > now + 5 * 60_000 && startsAt < now + 23.9 * 60 * 60_000) {
          movedWhen = ((await target.textContent()) ?? '').trim();
          await target.click();
          break;
        }
      }
      if (movedWhen) break;
    }
    expect(movedWhen, 'a free appointment is available within the next day').toBeTruthy();
    await expect(client).toHaveURL(/\/bookings\?notice=rescheduled$/);
    const before = new Set((await mailTo(PATIENT_3)).map((message) => message.ID));
    await reminders.check();
    await staff.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();

    const received = async () =>
      (await mailTo(PATIENT_3)).filter(
        (message) => !before.has(message.ID) && message.Subject === `Appointment reminder: ${movedWhen}`,
      );
    await expect.poll(async () => (await received()).length, { timeout: 75_000 }).toBe(1);
    const message = (await received())[0]!;
    const inbox = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
    const response = await fetch(`${inbox}/api/v1/message/${message.ID}`);
    expect(response.ok).toBe(true);
    const { Text: text } = (await response.json()) as { Text: string };
    expect(text).toContain(`When: ${movedWhen} (UK time, Europe/London)`);
    expect(text).toContain(`With: ${PRACTITIONER}`);
    expect(text).toContain(`/bookings/${bookingId}/reschedule`);
    expect(text).toContain(`/bookings#booking-${bookingId}`);
  } finally {
    await reminders.setChecked(originallyEnabled);
    await staff.getByRole('button', { name: 'Save settings', exact: true }).click();
    if (bookingId && originalSlot) {
      // Return the booking outside the late-cancellation window before
      // cancelling it, leaving both appointment times free for other checks.
      await client.goto(`/bookings/${bookingId}/reschedule`);
      await client.getByTestId('date-input').fill(londonDate(30));
      await client.getByTestId('show-slots').click();
      const original = client.locator(`[data-testid="reschedule-to"][data-slot-id="${originalSlot}"]`);
      if (await original.count()) await original.click();
      await client.goto('/bookings');
      await client.locator(`[data-booking-id="${bookingId}"]`).getByTestId('cancel-booking').click();
    }
    await client.context().close();
    await staff.context().close();
  }
});
