import { expect, test } from '@playwright/test';
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
  slotOffered,
} from './support';

test('Staff can block a practitioner’s time and see existing bookings without cancelling them', async ({ browser }) => {
  const date = londonDate(19);
  const client = await sessionFor(browser, PATIENT_1);
  const bookedSlot = await pickFreeSlot(client, date);
  const when = await bookSlot(client, bookedSlot.id);
  const otherClient = await sessionFor(browser, PATIENT_2);
  const freeSlot = await pickFreeSlot(otherClient, date);
  const admin = await sessionFor(browser, ADMIN);
  await admin.goto('/admin');
  await admin.getByRole('link', { name: 'Blocked time', exact: true }).click();
  await admin.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await admin.getByTestId('block-start').fill(`${date}T00:00`);
  await admin.getByTestId('block-end').fill(`${date}T23:59`);
  const reason = `Training on ${date}`;
  await admin.getByTestId('block-reason').fill(reason);
  await admin.getByTestId('block-save').click();
  const block = admin.getByTestId('blocked-period').filter({ hasText: reason });
  await expect(block.getByTestId('block-warning')).toContainText(PATIENT_1);
  await expect(block.getByTestId('block-warning')).toContainText('have not been cancelled');
  expect(await slotOffered(otherClient, date, freeSlot.id)).toBe(false);
  await otherClient.goto(`/book/${freeSlot.id}`);
  await expect(otherClient.getByTestId('confirm-booking')).toHaveCount(0);
  await client.goto('/bookings');
  await expect(bookingRow(client, 'upcoming-bookings', when)).toContainText('Confirmed');
  await block.getByRole('button', { name: 'Remove blocked time' }).click();
  expect(await slotOffered(otherClient, date, freeSlot.id)).toBe(true);
});
