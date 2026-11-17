import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  mailTo,
  pickFreeSlot,
  sessionFor,
  signIn,
  step,
} from './support';
import { calendarField, calendarInstant, downloadCalendar, emailedCalendar } from './calendar-support';

test.use({ viewport: { width: 375, height: 812 } });

// Each journey creates its own booking on a separate day, without relying on another check's data.
test('A client can download their confirmed booking from My bookings and receives the same calendar file by email', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_2);
  });
  const details = await step(page, 'Choose a session and confirm it without a phone number', async () => {
    const slot = await pickFreeSlot(page, londonDate(31));
    const startsAt = await page.getByTestId('slot-link').filter({ hasText: slot.time }).getAttribute('data-starts-at');
    const seen = new Set((await mailTo(PATIENT_2)).map((message) => message.ID));
    await page.goto(`/book/${slot.id}`);
    const when = (await page.getByTestId('book-when').innerText()).replace(/\s*\(.*\)\s*$/, '').trim();
    await page.getByTestId('book-phone').fill('');
    await page.getByTestId('confirm-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
    const row = bookingRow(page, 'upcoming-bookings', when);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
    return { when, startsAt, seen, id: (await row.getAttribute('data-booking-id'))! };
  });
  const file = await step(page, 'Add the confirmed session to a calendar', async () => {
    const file = await downloadCalendar(
      page,
      bookingRow(page, 'upcoming-bookings', details.when).getByTestId('add-to-calendar'),
    );
    expect(calendarField(file, 'SUMMARY')).toContain('Acme Physio');
    expect(calendarField(file, 'SUMMARY')).toContain(PRACTITIONER);
    expect(calendarInstant(file, 'DTSTART').toISOString()).toBe(details.startsAt);
    expect(calendarInstant(file, 'DTEND').getTime() - calendarInstant(file, 'DTSTART').getTime()).toBe(45 * 60_000);
    return file;
  });
  await step(page, 'Open the confirmation email and its matching calendar file', async () => {
    const email = await emailedCalendar(PATIENT_2, details.id, details.seen);
    expect(email.file).toBe(file);
    expect(email.text).toContain(`When: ${details.when} (Europe/London)`);
  });
  await step(page, 'Return to My bookings later and download the same session', async () => {
    await page.getByTestId('nav-my-bookings').click();
    await expect(page).toHaveURL(/\/bookings$/);
    expect(
      await downloadCalendar(page, bookingRow(page, 'upcoming-bookings', details.when).getByTestId('add-to-calendar')),
    ).toBe(file);
  });
});

test('Moving a booking updates its calendar download and sends a matching calendar file by email', async ({ page }) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_2);
  });
  const original = await step(page, 'Book a session and save its calendar file', async () => {
    const slot = await pickFreeSlot(page, londonDate(32));
    const when = await bookSlot(page, slot.id);
    const row = bookingRow(page, 'upcoming-bookings', when);
    const id = (await row.getAttribute('data-booking-id'))!;
    const file = await downloadCalendar(page, row.getByTestId('add-to-calendar'));
    await emailedCalendar(PATIENT_2, id, new Set());
    return { when, id, file };
  });
  const moved = await step(page, 'Move the session to another free time', async () => {
    const seen = new Set((await mailTo(PATIENT_2)).map((message) => message.ID));
    await bookingRow(page, 'upcoming-bookings', original.when).getByTestId('reschedule-link').click();
    const target = page.getByTestId('reschedule-to').filter({ hasText: '12:00' });
    await expect(target).toBeVisible();
    const startsAt = await target.getAttribute('data-starts-at');
    const when = (await target.innerText()).trim();
    await target.click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
    return { seen, startsAt, when };
  });
  const file = await step(page, 'Download the moved session with its new time and duration', async () => {
    const file = await downloadCalendar(
      page,
      bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('add-to-calendar'),
    );
    expect(calendarInstant(file, 'DTSTART').toISOString()).toBe(moved.startsAt);
    expect(calendarField(file, 'DTSTART')).not.toBe(calendarField(original.file, 'DTSTART'));
    expect(calendarField(file, 'UID')).toBe(calendarField(original.file, 'UID'));
    expect(calendarField(file, 'SEQUENCE')).toBe('1');
    expect(calendarField(file, 'SUMMARY')).toContain('Acme Physio');
    expect(calendarField(file, 'SUMMARY')).toContain(PRACTITIONER);
    expect(calendarInstant(file, 'DTEND').getTime() - calendarInstant(file, 'DTSTART').getTime()).toBe(45 * 60_000);
    return file;
  });
  await step(page, 'Receive a move confirmation email with the same new calendar file', async () => {
    const email = await emailedCalendar(PATIENT_2, original.id, moved.seen);
    expect(email.file).toBe(file);
    expect(email.text).toContain(`When: ${moved.when} (Europe/London)`);
  });
});

test('Visitors, other clients and staff cannot download a client’s booking calendar', async ({ browser, page }) => {
  const owner = await sessionFor(browser, PATIENT_2);
  const path = await step(owner, 'Book a session and open its calendar download', async () => {
    const slot = await pickFreeSlot(owner, londonDate(33));
    const when = await bookSlot(owner, slot.id);
    const link = bookingRow(owner, 'upcoming-bookings', when).getByTestId('add-to-calendar');
    expect(await downloadCalendar(owner, link)).toContain('BEGIN:VEVENT');
    return (await link.getAttribute('href'))!;
  });
  await step(page, 'Try the same calendar address without signing in', async () => {
    await page.goto('/auth/sign-in');
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
    expect((await response.text()).trim()).toBe('We could not find that booking.');
  });
  const stranger = await sessionFor(browser, PATIENT_1);
  await step(stranger, 'Try the calendar address as another client', async () => {
    const response = await stranger.request.get(path);
    expect(response.status()).toBe(404);
    expect((await response.text()).trim()).toBe('We could not find that booking.');
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Try the client calendar address as clinic staff', async () => {
    const response = await staff.request.get(path);
    expect(response.status()).toBe(404);
    expect((await response.text()).trim()).toBe('We could not find that booking.');
  });
  await owner.context().close();
  await stranger.context().close();
  await staff.context().close();
});
