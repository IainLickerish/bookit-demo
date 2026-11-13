import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, bookSlot, bookingRow, londonDate, pickFreeSlot, sessionFor, step } from './support';

test('Invalid block details show a useful error and retain entries without changing bookings.', async ({ browser }) => {
  const date = londonDate(27);
  const reason = 'Invalid details retention check';
  const client = await sessionFor(browser, PATIENT_1);
  const bookings = await step(client, 'Book a session with each of the two physiotherapists', async () => {
    const firstWhen = await bookSlot(client, (await pickFreeSlot(client, date)).id);
    await client.getByTestId('nav-book').click();
    await client.getByTestId('practitioner-select').selectOption({ label: 'Sam Physiotherapist' });
    await client.getByTestId('date-input').fill(date);
    await client.getByTestId('show-slots').click();
    await expect(client).toHaveURL((url) => url.searchParams.get('date') === date);
    const slot = client.getByTestId('slot-link').last();
    await expect(slot).toBeVisible();
    const secondWhen = await bookSlot(client, (await slot.getAttribute('data-slot-id'))!);
    // Different times let us identify each booking independently in My bookings.
    expect(firstWhen).not.toBe(secondWhen);
    return { firstWhen, secondWhen };
  });
  const staff = await sessionFor(browser, ADMIN);
  const history = await step(staff, 'Open blocked time and choose the second physiotherapist', async () => {
    await staff.goto('/admin');
    await staff.getByTestId('admin-blocked-time-link').click();
    await expect(staff.getByTestId('block-practitioner').locator('option')).toHaveCount(2);
    const selected = await staff.getByTestId('block-practitioner').selectOption({ label: 'Sam Physiotherapist' });
    expect(selected[0]).not.toBe(
      await staff.getByTestId('block-practitioner').locator('option').first().getAttribute('value'),
    );
    return {
      selected: selected[0]!,
      links: await staff
        .getByTestId('block-open')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    };
  });
  await step(staff, 'Review an end before the start and keep every entry after the error', async () => {
    await staff.getByTestId('block-start').fill(`${date}T09:00`);
    await staff.getByTestId('block-end').fill(`${date}T08:00`);
    await staff.getByTestId('block-reason').fill(reason);
    await staff.getByTestId('block-review').click();
    await expect(staff.getByTestId('block-error')).toContainText('end after the start');
    await expect(staff.getByTestId('block-practitioner')).toHaveValue(history.selected);
    await expect(staff.getByTestId('block-start')).toHaveValue(`${date}T09:00`);
    await expect(staff.getByTestId('block-end')).toHaveValue(`${date}T08:00`);
    await expect(staff.getByTestId('block-reason')).toHaveValue(reason);
    await expect(staff.getByTestId('block-preview')).toHaveCount(0);
    await expect(staff.getByTestId('block-saved')).toHaveCount(0);
  });
  await step(staff, 'Correct only the end and review the intended physiotherapist without saving', async () => {
    await staff.getByTestId('block-end').fill(`${date}T17:00`);
    await staff.getByTestId('block-review').click();
    await expect(staff.getByTestId('block-preview')).toContainText('Sam Physiotherapist');
    await expect(staff.getByTestId('block-affected-booking')).toHaveCount(1);
    await expect(staff.getByTestId('block-affected-booking')).toContainText(bookings.secondWhen);
    await expect(staff.getByTestId('block-affected-booking')).not.toContainText(bookings.firstWhen);
    await staff.getByTestId('block-edit').click();
    await expect(staff.getByTestId('block-practitioner')).toHaveValue(history.selected);
    await expect(staff.getByTestId('block-start')).toHaveValue(`${date}T09:00`);
    await expect(staff.getByTestId('block-end')).toHaveValue(`${date}T17:00`);
    await expect(staff.getByTestId('block-reason')).toHaveValue(reason);
  });
  await step(client, 'Reopen both lists and see that no block or cancellation was saved', async () => {
    await staff.reload();
    await expect(staff.getByTestId('block-open')).toHaveCount(history.links.length);
    expect(
      await staff.getByTestId('block-open').evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(history.links);
    await expect(staff.getByTestId('block-list-row').filter({ hasText: reason })).toHaveCount(0);
    await client.reload();
    await expect(bookingRow(client, 'upcoming-bookings', bookings.firstWhen)).toContainText('Confirmed');
    await expect(bookingRow(client, 'upcoming-bookings', bookings.secondWhen)).toContainText('Confirmed');
    await expect(bookingRow(client, 'other-bookings', bookings.firstWhen)).toHaveCount(0);
    await expect(bookingRow(client, 'other-bookings', bookings.secondWhen)).toHaveCount(0);
  });
});
