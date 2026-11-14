import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  mailTo,
  sessionFor,
  showDay,
  signIn,
  step,
} from './support';

async function chooseSession(page: Page, daysAhead: number) {
  await showDay(page, londonDate(daysAhead));
  const slot = page.getByTestId('slot-link').filter({ hasText: /13:30$/ });
  await expect(slot).toBeVisible();
  const href = (await slot.getAttribute('href'))!;
  await slot.click();
  const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  return { href, when };
}

async function downloadCalendar(page: Page, link: Locator): Promise<string> {
  const downloading = page.waitForEvent('download');
  await link.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('booking.ics');
  const file = await download.path();
  expect(file).toBeTruthy();
  return (await readFile(file!, 'utf8')).replace(/\r\n /g, '');
}

function expectCalendar(calendar: string, when: string) {
  expect(calendar).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
  expect(calendar).toContain(`SUMMARY:Acme Physio with ${PRACTITIONER}`);
  expect(calendar).toContain(when.replace(/,/g, '\\,'));
  const start = /DTSTART:(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/.exec(calendar)!;
  const end = /DTEND:(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/.exec(calendar)!;
  const instant = (parts: RegExpExecArray) =>
    new Date(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}Z`);
  expect(instant(end).getTime() - instant(start).getTime()).toBe(45 * 60_000);
  expect(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant(start)),
  ).toBe(when);
}

test('After booking or moving, clients can use Add to calendar from the confirmation and their upcoming booking in My bookings.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_1);
  });
  const when = await step(page, 'Choose a session and confirm the booking', async () => {
    const { href, when } = await chooseSession(page, 40);
    await bookSlot(page, href.split('/').pop()!);
    return when;
  });
  const original = await step(page, 'Add the confirmed session to a calendar', async () => {
    await expect(page.getByTestId('notice')).toContainText('Booking confirmed.');
    const calendar = await downloadCalendar(page, page.getByTestId('confirmation-add-to-calendar'));
    expectCalendar(calendar, when);
    return calendar;
  });
  await step(page, 'Find the same calendar file in My bookings', async () => {
    await page.getByTestId('nav-my-bookings').click();
    const link = bookingRow(page, 'upcoming-bookings', when).getByTestId('add-to-calendar');
    expect(await downloadCalendar(page, link)).toBe(original);
  });
  const movedWhen = await step(page, 'Move the session and add its new time from the confirmation', async () => {
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
    const choice = page.getByTestId('reschedule-to').filter({ hasText: /14:15$/ });
    const movedWhen = ((await choice.textContent()) ?? '').trim();
    await choice.click();
    await expect(page.getByTestId('notice')).toContainText('Booking rescheduled.');
    const calendar = await downloadCalendar(page, page.getByTestId('confirmation-add-to-calendar'));
    expectCalendar(calendar, movedWhen);
    expect(calendar.match(/UID:.+/)?.[0]).toBe(original.match(/UID:.+/)?.[0]);
    expect(calendar).toContain('SEQUENCE:1\r\n');
    expect(calendar).not.toContain(when.replace(/,/g, '\\,'));
    return movedWhen;
  });
  await step(page, 'Add the moved session from My bookings', async () => {
    await page.getByTestId('nav-my-bookings').click();
    expectCalendar(
      await downloadCalendar(page, bookingRow(page, 'upcoming-bookings', movedWhen).getByTestId('add-to-calendar')),
      movedWhen,
    );
  });
});

test('Booking and move confirmation emails include a calendar file with the saved time.', async ({ page }) => {
  let before: Set<string>;
  await step(page, 'Sign in and open the inbox for this client', async () => {
    await signIn(page, PATIENT_2);
    before = new Set((await mailTo(PATIENT_2)).map((message) => message.ID));
  });
  const when = await step(page, 'Book a session', async () => {
    const { href, when } = await chooseSession(page, 41);
    await bookSlot(page, href.split('/').pop()!);
    return when;
  });
  await step(page, 'Receive a booking email with its calendar file', async () => {
    const calendar = await emailedCalendar(PATIENT_2, before, `Booking confirmed: ${when}`);
    expectCalendar(calendar, when);
  });
  const movedWhen = await step(page, 'Move the session to a new time', async () => {
    await bookingRow(page, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
    const choice = page.getByTestId('reschedule-to').filter({ hasText: /14:15$/ });
    const movedWhen = ((await choice.textContent()) ?? '').trim();
    await choice.click();
    await expect(page.getByTestId('notice')).toContainText('Booking rescheduled.');
    return movedWhen;
  });
  await step(page, 'Receive a move email with the new calendar time', async () => {
    const calendar = await emailedCalendar(PATIENT_2, before, `Booking moved: ${movedWhen}`);
    expectCalendar(calendar, movedWhen);
    expect(calendar).toContain('SEQUENCE:1\r\n');
    expect(calendar).not.toContain(when.replace(/,/g, '\\,'));
  });
});

test('Visitors, staff and other clients cannot download a client’s calendar details.', async ({ browser, page }) => {
  const owner = await sessionFor(browser, PATIENT_1);
  const path = await step(owner, 'Book a session and find its calendar download', async () => {
    const { href, when } = await chooseSession(owner, 42);
    await bookSlot(owner, href.split('/').pop()!);
    const link = bookingRow(owner, 'upcoming-bookings', when).getByTestId('add-to-calendar');
    await expect(link).toBeVisible();
    return (await link.getAttribute('href'))!;
  });
  await step(page, 'Try the download without signing in and see no calendar details', async () => {
    await page.goto('/auth/sign-in');
    await expectDownloadRefused(page, path, 401);
  });
  const other = await sessionFor(browser, PATIENT_2);
  await step(other, 'Try another client’s download and see no calendar details', async () => {
    await expectDownloadRefused(other, path, 404);
  });
  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Try a client download as staff and see no calendar details', async () => {
    await expectDownloadRefused(staff, path, 403);
  });
  await Promise.all([owner.context().close(), other.context().close(), staff.context().close()]);
});

async function expectDownloadRefused(page: Page, path: string, status: number) {
  const response = await page.request.get(path);
  expect(response.status()).toBe(status);
  expect(await response.text()).not.toMatch(/BEGIN:VCALENDAR|Acme Physio|Alex Physiotherapist|DTSTART/);
  expect(response.headers()['cache-control']).toContain('no-store');
}

async function emailedCalendar(address: string, before: Set<string>, subject: string): Promise<string> {
  const matching = async () => (await mailTo(address)).find((m) => !before.has(m.ID) && m.Subject === subject);
  await expect.poll(matching, { timeout: 15_000 }).toBeTruthy();
  const message = (await matching())!;
  const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
  expect(response.ok).toBe(true);
  const email = (await response.json()) as {
    Attachments: { FileName: string; PartID: string; ContentType: string }[];
  };
  const attachment = email.Attachments.find((item) => item.FileName === 'booking.ics');
  expect(attachment, 'the email has a calendar file').toBeTruthy();
  expect(attachment!.ContentType).toContain('text/calendar');
  const file = await fetch(
    `${base}/api/v1/message/${encodeURIComponent(message.ID)}/part/${encodeURIComponent(attachment!.PartID)}`,
  );
  expect(file.ok).toBe(true);
  return (await file.text()).replace(/\r\n /g, '');
}
