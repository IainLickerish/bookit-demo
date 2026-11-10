import { expect, test } from '@playwright/test';
import {
  PATIENT_1,
  PATIENT_2,
  PATIENT_3,
  bookSlot,
  givePhone,
  londonDate,
  pickFreeSlot,
  sessionFor,
  slotOffered,
} from './support';

test('Once a time is booked, no other client is offered it or can book it', async ({ browser }) => {
  const date = londonDate(11);
  const first = await sessionFor(browser, PATIENT_1);
  const slot = await pickFreeSlot(first, date);
  await bookSlot(first, slot.id);

  const second = await sessionFor(browser, PATIENT_2);
  expect(await slotOffered(second, date, slot.id), 'the booked time is not offered').toBe(false);
  await second.goto(`/book/${slot.id}`);
  await expect(second.getByTestId('confirm-booking')).toHaveCount(0);
});

test('When two clients try to book the same time at once, only one gets it', async ({ browser }) => {
  const date = londonDate(12);
  const [a, b] = [await sessionFor(browser, PATIENT_2), await sessionFor(browser, PATIENT_3)];
  const slot = await pickFreeSlot(a, date);
  await Promise.all([a.goto(`/book/${slot.id}`), b.goto(`/book/${slot.id}`)]);
  await Promise.all([givePhone(a), givePhone(b)]);
  await Promise.all([a.getByTestId('confirm-booking').click(), b.getByTestId('confirm-booking').click()]);
  // Each page settles on either the confirmation or a message that the time has gone.
  const settled = (p: typeof a) =>
    p
      .waitForURL(
        (u) => u.pathname === '/bookings' || u.searchParams.has('error') || !u.pathname.startsWith('/book/'),
        { timeout: 15_000 },
      )
      .catch(() => undefined);
  await Promise.all([settled(a), settled(b)]);
  const booked = [a.url(), b.url()].filter((u) => u.endsWith('/bookings?notice=booked'));
  expect(booked, 'exactly one client got the time').toHaveLength(1);
});
