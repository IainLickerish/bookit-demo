import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  mailTo,
  showDay,
  signIn,
  step,
} from './support';

async function fillBlock(page: Page, date: string, start: string, end: string, reason: string) {
  await page.getByTestId('nav-admin').click();
  await page.getByTestId('admin-blocks-link').click();
  await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
  await page.getByTestId('block-start').fill(`${date}T${start}`);
  await page.getByTestId('block-end').fill(`${date}T${end}`);
  await page.getByTestId('block-reason').fill(reason);
}

async function slotAt(page: Page, date: string, time: string) {
  await showDay(page, date);
  const choice = page.getByTestId('slot-link').filter({ hasText: time });
  await expect(choice).toBeVisible();
  return (await choice.getAttribute('data-slot-id'))!;
}

test('Clinic staff can save a practitioner’s start, end and optional reason, see the saved block, and correct invalid entries without losing other fields.', async ({
  page,
}) => {
  const date = londonDate(40);
  const reason = 'Training for the blocked-time form check';
  await step(page, 'Sign in as clinic staff and open blocked time', async () => {
    await signIn(page, ADMIN);
    await fillBlock(page, date, '10:00', '09:00', reason);
  });
  await step(page, 'Try an end before the start and keep all the other entries', async () => {
    await page.getByTestId('block-save').click();
    await expect(page.getByTestId('block-error')).toBeVisible();
    await expect(page.getByTestId('block-end-error')).toContainText('end after the start');
    await expect(page.getByTestId('block-start')).toHaveValue(`${date}T10:00`);
    await expect(page.getByTestId('block-end')).toHaveValue(`${date}T09:00`);
    await expect(page.getByTestId('block-practitioner').locator('option:checked')).toHaveText(PRACTITIONER);
    await expect(page.getByTestId('block-reason')).toHaveValue(reason);
  });
  await step(page, 'Correct the end and see the saved time and reason', async () => {
    await page.getByTestId('block-end').fill(`${date}T11:00`);
    await page.getByTestId('block-save').click();
    await expect(page.getByTestId('block-saved')).toContainText('Blocked time saved');
    const saved = page.getByTestId('block-row').filter({ hasText: reason });
    await expect(saved).toContainText(PRACTITIONER);
    await expect(saved.getByTestId('block-saved-start')).toContainText('10:00');
    await expect(saved.getByTestId('block-saved-end')).toContainText('11:00');
    await expect(saved.getByTestId('block-no-conflicts')).toContainText('No confirmed bookings overlap');
  });
  const rejectedReason = 'Clock-change block awaiting correction in the form check';
  await step(page, 'Start another save in a skipped hour and see only its failure result', async () => {
    await page.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
    await page.getByTestId('block-start').fill('2027-03-28T01:30');
    await page.getByTestId('block-end').fill('2027-03-28T03:00');
    await page.getByTestId('block-reason').fill(rejectedReason);
    // Hold the request until the browser has removed the preceding success notice.
    await page.route('**/admin/blocks*', async (route) => {
      if (route.request().method() === 'POST') {
        await expect(page.getByTestId('block-saved')).toHaveCount(0);
      }
      await route.continue();
    });
    await page.getByTestId('block-save').click();
    await expect(page.getByTestId('block-start-error')).toContainText('skipped');
    await expect(page.getByTestId('block-error')).toContainText('could not be saved');
    await expect(page.getByTestId('block-saved')).toHaveCount(0);
    await expect(page.getByTestId('block-reason')).toHaveValue(rejectedReason);
    await expect(page.getByTestId('block-row').filter({ hasText: rejectedReason })).toHaveCount(0);
    await expect(page.getByTestId('block-row').filter({ hasText: reason })).toBeVisible();
  });
  await step(page, 'Try a repeated hour and keep the error without reviving the earlier success', async () => {
    await page.getByTestId('block-start').fill('2027-10-31T01:30');
    await page.getByTestId('block-end').fill('2027-10-31T03:00');
    await page.getByTestId('block-save').click();
    await expect(page.getByTestId('block-start-error')).toContainText('occurs twice');
    await expect(page.getByTestId('block-error')).toContainText('could not be saved');
    await expect(page.getByTestId('block-saved')).toHaveCount(0);
    await expect(page.getByTestId('block-start')).toHaveValue('2027-10-31T01:30');
    await expect(page.getByTestId('block-end')).toHaveValue('2027-10-31T03:00');
    await expect(page.getByTestId('block-practitioner').locator('option:checked')).toHaveText(PRACTITIONER);
    await expect(page.getByTestId('block-row').filter({ hasText: rejectedReason })).toHaveCount(0);
  });
  await step(page, 'Correct the second block and see a fresh saved result', async () => {
    await page.getByTestId('block-start').fill(`${date}T12:00`);
    await page.getByTestId('block-end').fill(`${date}T13:00`);
    await page.getByTestId('block-save').click();
    await expect(page.getByTestId('block-saved')).toContainText('Blocked time saved');
    await expect(page.getByTestId('block-error')).toHaveCount(0);
    const saved = page.getByTestId('block-row').filter({ hasText: rejectedReason });
    await expect(saved.getByTestId('block-saved-start')).toContainText('12:00');
    await expect(saved.getByTestId('block-saved-end')).toContainText('13:00');
    await expect(page.getByTestId('block-row').filter({ hasText: reason })).toBeVisible();
  });
  await step(page, 'Return to the clinic diary', async () => {
    await page.getByTestId('blocks-back').click();
    await expect(page.getByRole('heading', { name: 'Clinic bookings' })).toBeVisible();
  });
});

test('Clients are neither offered nor allowed to book or move into overlapping times, including when a block is saved during booking.', async ({
  browser,
}) => {
  const client = await (await browser.newContext()).newPage();
  const staff = await (await browser.newContext()).newPage();
  const staleBooking = await client.context().newPage();
  const date = londonDate(41);
  let when = '';
  let targetId = '';
  const reason = 'Private staff training for the overlapping-time check';
  await step(client, 'Book a session and open the choice to move it', async () => {
    await signIn(client, PATIENT_1);
    when = await bookSlot(client, await slotAt(client, date, '09:00'));
    await bookingRow(client, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
    await client.getByTestId('date-input').fill(date);
    await client.getByTestId('show-slots').click();
    const choice = client.getByTestId('reschedule-to').filter({ hasText: '09:45' });
    await expect(choice).toBeVisible();
    targetId = (await choice.getAttribute('data-slot-id'))!;
  });
  await step(staleBooking, 'Open a booking confirmation for the same free time', async () => {
    await staleBooking.goto(`/book/${targetId}`);
    await expect(staleBooking.getByTestId('confirm-booking')).toBeVisible();
  });
  await step(staff, 'Save a short block inside that session while the client is choosing', async () => {
    await signIn(staff, ADMIN);
    await fillBlock(staff, date, '09:46', '09:47', reason);
    await staff.getByTestId('block-save').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
  });
  await step(staleBooking, 'Try the open booking confirmation and see that the time is unavailable', async () => {
    await staleBooking.getByTestId('confirm-booking').click();
    await expect(staleBooking.getByTestId('booking-error')).toContainText('no longer available');
    await expect(staleBooking.getByTestId('confirm-booking')).toHaveCount(0);
    await expect(staleBooking.locator('main')).not.toContainText(reason);
  });
  await step(client, 'Try the open move choice and keep the original confirmed booking', async () => {
    await client.getByTestId('reschedule-to').filter({ hasText: '09:45' }).click();
    await expect(client.getByTestId('booking-error')).toContainText('no longer available');
    await expect(client.getByTestId('reschedule-to').filter({ hasText: '09:45' })).toHaveCount(0);
    await client.getByTestId('nav-my-bookings').click();
    await expect(bookingRow(client, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
  });
  await step(
    client,
    'See that the blocked session is absent and a neighbouring session remains available',
    async () => {
      await showDay(client, date);
      await expect(client.getByTestId('slot-link').filter({ hasText: '09:45' })).toHaveCount(0);
      await expect(client.getByTestId('slot-link').filter({ hasText: '10:30' })).toBeVisible();
      await expect(client.locator('main')).not.toContainText(reason);
    },
  );
  await step(client, 'Move to an unaffected time and receive a confirmation of the new time', async () => {
    const seen = new Set((await mailTo(PATIENT_1)).map((mail) => mail.ID));
    await client.getByTestId('nav-my-bookings').click();
    await bookingRow(client, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
    const target = client.getByTestId('reschedule-to').filter({ hasText: '11:15' });
    const newWhen = (await target.textContent())!.trim();
    await target.click();
    await expect(bookingRow(client, 'upcoming-bookings', newWhen).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
    let messageId = '';
    await expect
      .poll(async () => {
        const message = (await mailTo(PATIENT_1)).find(
          (mail) => !seen.has(mail.ID) && mail.Subject.startsWith('Booking rescheduled:'),
        );
        messageId = message?.ID ?? '';
        return message?.Subject ?? '';
      })
      .toContain(newWhen);
    const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
    const message = (await (await fetch(`${base}/api/v1/message/${messageId}`)).json()) as { Text: string };
    expect(message.Text).toContain(newWhen);
    expect(message.Text).toContain(PRACTITIONER);
    expect(message.Text).toContain('has been rescheduled');
    expect(message.Text).not.toContain(reason);
  });
  await client.context().close();
  await staff.context().close();
});

test('Staff see every affected confirmed booking in a warning, or a clear no-conflicts message; existing bookings remain confirmed and unchanged.', async ({
  browser,
}) => {
  const first = await (await browser.newContext()).newPage();
  const second = await (await browser.newContext()).newPage();
  const staff = await (await browser.newContext()).newPage();
  const date = londonDate(42);
  let firstWhen = '';
  let secondWhen = '';
  const reason = 'Holiday for the affected-booking check';
  await step(first, 'Book the first client’s session', async () => {
    await signIn(first, PATIENT_1);
    firstWhen = await bookSlot(first, await slotAt(first, date, '09:00'));
  });
  await step(second, 'Book a neighbouring session as another client', async () => {
    await signIn(second, PATIENT_2);
    secondWhen = await bookSlot(second, await slotAt(second, date, '09:45'));
  });
  await step(staff, 'Save a block that overlaps both confirmed sessions', async () => {
    await signIn(staff, ADMIN);
    await fillBlock(staff, date, '09:30', '10:00', reason);
    await staff.getByTestId('block-save').click();
    await expect(staff.getByTestId('block-saved')).toBeVisible();
  });
  await step(staff, 'Read the warning listing both clients and their confirmed bookings', async () => {
    const saved = staff.getByTestId('block-row').filter({ hasText: reason });
    await expect(saved.getByTestId('block-conflicts')).toContainText('Contact the clients');
    const one = saved.getByTestId('block-affected-booking').filter({ hasText: 'Zoë Brontë' });
    const two = saved.getByTestId('block-affected-booking').filter({ hasText: 'Łukasz Wiśniewski' });
    for (const [row, when] of [
      [one, firstWhen],
      [two, secondWhen],
    ] as const) {
      await expect(row).toContainText(when);
      await expect(row).toContainText(PRACTITIONER);
      await expect(row).toContainText('Confirmed');
    }
  });
  await step(staff, 'Download the filtered diary with both affected clients’ names and times', async () => {
    await staff.getByTestId('blocks-back').click();
    await staff.getByTestId('admin-date').fill(date);
    await staff.getByTestId('admin-status').selectOption('confirmed');
    await staff.getByTestId('admin-filter').click();
    for (const name of ['Zoë Brontë', 'Łukasz Wiśniewski']) {
      await expect(staff.getByTestId('admin-booking-row').filter({ hasText: name })).toContainText('Confirmed');
    }
    const downloaded = staff.waitForEvent('download');
    await staff.getByTestId('admin-export').click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('bookings.csv');
    const csv = await readFile((await file.path())!, 'utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    for (const name of ['Zoë Brontë', 'Łukasz Wiśniewski']) expect(csv).toContain(`"${name}"`);
    expect(csv).toContain('"confirmed"');
    expect(csv).not.toContain('"cancelled"');
    expect(csv).not.toContain(reason);
    // This check’s two bookings occupy the only selected times on its own date.
    const records = csv.trim().split('\r\n').slice(1);
    expect(records).toHaveLength(2);
    for (const record of records) expect(record).toContain(date);
  });
  await step(staff, 'Save another block with no reason and see the no-conflicts message', async () => {
    await fillBlock(staff, date, '15:01', '15:02', '');
    await staff.getByTestId('block-save').click();
    const saved = staff
      .getByTestId('block-row')
      .filter({ has: staff.getByTestId('block-saved-start').filter({ hasText: '15:01' }) });
    await expect(saved.getByTestId('block-no-conflicts')).toContainText('No confirmed bookings overlap');
    await expect(saved.getByTestId('block-saved-reason')).toContainText('No reason given');
  });
  await step(first, 'Find the first session still confirmed at its original time', async () => {
    await first.getByTestId('nav-my-bookings').click();
    await expect(bookingRow(first, 'upcoming-bookings', firstWhen).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
  });
  await step(second, 'Find the second session still confirmed at its original time', async () => {
    await second.getByTestId('nav-my-bookings').click();
    await expect(bookingRow(second, 'upcoming-bookings', secondWhen).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
  });
  await first.context().close();
  await second.context().close();
  await staff.context().close();
});
