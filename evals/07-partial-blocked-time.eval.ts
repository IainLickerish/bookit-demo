import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, PRACTITIONER, londonDate, pickFreeSlot, sessionFor, slotOffered } from './support';

test('Clients cannot book an appointment that overlaps even a few minutes of blocked time', async ({ browser }) => {
  const date = londonDate(22);
  const client = await sessionFor(browser, PATIENT_2);
  const target = await pickFreeSlot(client, date);
  const neighbour = (await client.getByTestId('slot-link').nth(1).getAttribute('data-slot-id')) ?? '';
  expect(neighbour).not.toBe('');
  const [hour, minute] = target.time.split(':').map(Number);
  const time = (offset: number) => {
    const total = hour! * 60 + minute! + offset;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  const start = `${date}T${time(1)}`;
  const end = `${date}T${time(2)}`;
  const label = (value: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(`${value}:00Z`),
    );
  const admin = await sessionFor(browser, ADMIN);
  await admin.goto('/admin');
  await admin.getByRole('link', { name: 'Blocked time', exact: true }).click();
  await admin.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await admin.getByTestId('block-start').fill(start);
  await admin.getByTestId('block-end').fill(end);
  // Staff can leave the reason blank for a short absence.
  await admin.getByTestId('block-save').click();
  const block = admin.getByTestId('blocked-period').filter({ hasText: `${label(start)} to ${label(end)}` });
  await expect(block).toBeVisible();
  try {
    expect(await slotOffered(client, date, target.id)).toBe(false);
    expect(await slotOffered(client, date, neighbour)).toBe(true);
    await client.goto(`/book/${target.id}`);
    await expect(client.getByTestId('confirm-booking')).toHaveCount(0);
  } finally {
    await block.getByRole('button', { name: 'Remove blocked time' }).click();
  }
  expect(await slotOffered(client, date, target.id)).toBe(true);
});
