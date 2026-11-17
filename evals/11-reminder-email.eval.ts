import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_3,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  evalNow,
  londonDate,
  pickFreeSlot,
  signIn,
  step,
} from './support';
import { dispatchAt, remindersFor, reminderTime, setReminders } from './reminder-support';

test('A client receives one reminder with clinic-local details and My bookings links', async ({ page, browser }) => {
  const staff = await (await browser.newContext()).newPage();
  const other = await (await browser.newContext()).newPage();
  const date = londonDate(11);
  let when = '';
  let id = '';
  let due = '';
  let clinicName = '';
  let original = true;
  let text = '';
  await step(page, 'Book a session more than a day ahead as a client', async () => {
    await signIn(page, PATIENT_1);
    const slot = await pickFreeSlot(page, date);
    when = await bookSlot(page, slot.id);
    id = (await bookingRow(page, 'upcoming-bookings', when).getAttribute('data-booking-id'))!;
    due = reminderTime(date, slot.time);
    clinicName = (await page.getByTestId('clinic-name').textContent())!.trim();
    expect(new Date(due).getTime()).toBeGreaterThan(evalNow().getTime());
  });
  await step(staff, 'Sign in as staff and switch reminders on', async () => {
    await signIn(staff, ADMIN);
    await staff.goto('/admin/settings');
    original = await staff.getByTestId('admin-reminders-enabled').isChecked();
    await setReminders(staff, true);
  });
  try {
    await step(staff, 'Reach the reminder time and find the client email', async () => {
      expect(await dispatchAt(staff, id, new Date(new Date(due).getTime() - 1).toISOString())).toBe(0);
      expect(await remindersFor(PATIENT_1, id)).toHaveLength(0);
      expect(await dispatchAt(staff, id, due)).toBe(1);
      await expect.poll(async () => (await remindersFor(PATIENT_1, id)).length).toBe(1);
      text = (await remindersFor(PATIENT_1, id))[0]!.text;
      expect(text.startsWith(`${clinicName}\n`)).toBe(true);
      expect(text).toContain(`When: ${when} (Europe/London)`);
      expect(text).toContain(`With your physiotherapist: ${PRACTITIONER}`);
      expect(text).toContain('To reschedule your session, sign in to My bookings:');
      expect(text).toContain('To cancel your session, sign in to My bookings:');
    });
    await step(staff, 'Repeat the reminder check and see only one email for this booking', async () => {
      expect(await dispatchAt(staff, id, new Date(new Date(due).getTime() + 60_000).toISOString())).toBe(0);
      expect(await remindersFor(PATIENT_1, id)).toHaveLength(1);
    });
    await step(page, 'Open both email links, signing in to see the client booking', async () => {
      const links = [...text.matchAll(/https?:\/\/[^\s]+\/bookings#booking-[^\s]+/g)].map((match) => new URL(match[0]));
      expect(links).toHaveLength(2);
      await page.getByTestId('sign-out').click();
      for (const link of links) {
        await page.goto(`${link.pathname}${link.hash}`);
        await expect(page).toHaveURL(/\/auth\/sign-in(?:#.*)?$/);
      }
      await signIn(page, PATIENT_1);
      await expect(bookingRow(page, 'upcoming-bookings', when)).toContainText('Confirmed');
      await page.goto(`${links[1]!.pathname}${links[1]!.hash}`);
      await expect(bookingRow(page, 'upcoming-bookings', when)).toContainText('Confirmed');
      await signIn(other, PATIENT_3);
      for (const link of links) {
        await other.goto(`${link.pathname}${link.hash}`);
        await expect(other.getByRole('heading', { name: 'My bookings' })).toBeVisible();
        await expect(bookingRow(other, 'upcoming-bookings', when)).toHaveCount(0);
      }
      await page.reload();
      await expect(bookingRow(page, 'upcoming-bookings', when)).toContainText('Confirmed');
    });
  } finally {
    await step(staff, 'Restore the clinic reminder choice', async () => {
      await staff.goto('/admin/settings');
      await setReminders(staff, original);
    });
    await staff.context().close();
    await other.context().close();
  }
});

test('Cancelled bookings and bookings made less than 24 hours ahead receive no reminder', async ({ page, browser }) => {
  const staff = await (await browser.newContext()).newPage();
  const cancelledDate = londonDate(12);
  let cancelledId = '';
  let cancelledDue = '';
  let soonId = '';
  let soonDue = '';
  let original = true;
  await step(page, 'Book and cancel a session several days ahead', async () => {
    await signIn(page, PATIENT_1);
    const slot = await pickFreeSlot(page, cancelledDate);
    const when = await bookSlot(page, slot.id);
    const row = bookingRow(page, 'upcoming-bookings', when);
    cancelledId = (await row.getAttribute('data-booking-id'))!;
    cancelledDue = reminderTime(cancelledDate, slot.time);
    await row.getByTestId('cancel-booking').click();
    await expect(bookingRow(page, 'other-bookings', when)).toContainText('Cancelled');
  });
  await step(page, 'Book another session less than a day ahead', async () => {
    const date = londonDate(0);
    const slot = await pickFreeSlot(page, date);
    const when = await bookSlot(page, slot.id);
    soonId = (await bookingRow(page, 'upcoming-bookings', when).getAttribute('data-booking-id'))!;
    soonDue = reminderTime(date, slot.time);
    expect(new Date(soonDue).getTime()).toBeLessThan(evalNow().getTime());
  });
  await step(staff, 'Sign in as staff and switch reminders on', async () => {
    await signIn(staff, ADMIN);
    await staff.goto('/admin/settings');
    original = await staff.getByTestId('admin-reminders-enabled').isChecked();
    await setReminders(staff, true);
  });
  try {
    await step(staff, 'Check each reminder time and find no email for either booking', async () => {
      expect(await dispatchAt(staff, cancelledId, cancelledDue)).toBe(0);
      expect(await dispatchAt(staff, soonId, soonDue)).toBe(0);
      expect(await remindersFor(PATIENT_1, cancelledId)).toHaveLength(0);
      expect(await remindersFor(PATIENT_1, soonId)).toHaveLength(0);
    });
  } finally {
    await step(staff, 'Restore the clinic reminder choice', async () => {
      await staff.goto('/admin/settings');
      await setReminders(staff, original);
    });
    await staff.context().close();
  }
});

test('Clinics with reminders switched off send no reminder emails', async ({ page, browser }) => {
  const staff = await (await browser.newContext()).newPage();
  const date = londonDate(13);
  let id = '';
  let due = '';
  let original = true;
  await step(page, 'Book a session several days ahead', async () => {
    await signIn(page, PATIENT_1);
    const slot = await pickFreeSlot(page, date);
    const when = await bookSlot(page, slot.id);
    id = (await bookingRow(page, 'upcoming-bookings', when).getAttribute('data-booking-id'))!;
    due = reminderTime(date, slot.time);
  });
  await step(staff, 'Sign in as staff and save reminders switched off', async () => {
    await signIn(staff, ADMIN);
    await staff.goto('/admin/settings');
    original = await staff.getByTestId('admin-reminders-enabled').isChecked();
    await setReminders(staff, false);
  });
  try {
    await step(staff, 'Reach the reminder time and find no reminder for the booking', async () => {
      expect(await dispatchAt(staff, id, due)).toBe(0);
      expect(await remindersFor(PATIENT_1, id)).toHaveLength(0);
    });
    await step(staff, 'Switch reminders on and see this booking receive its reminder', async () => {
      await setReminders(staff, true);
      expect(await dispatchAt(staff, id, due)).toBe(1);
      await expect.poll(async () => (await remindersFor(PATIENT_1, id)).length).toBe(1);
    });
  } finally {
    await step(staff, 'Restore the original reminder choice', async () => {
      await staff.goto('/admin/settings');
      await setReminders(staff, original);
    });
    await staff.context().close();
  }
});
