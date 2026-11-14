import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookingRow,
  dateInPeriod,
  londonDate,
  mailTo,
  showDay,
  signIn,
  slotOffered,
  step,
} from './support';

// Factory demos may use a private HTTP hostname instead of localhost. Give
// that test origin the same Clipboard API support as a local browser demo.
test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
  launchOptions: {
    args: [
      `--unsafely-treat-insecure-origin-as-secure=${new URL(process.env.EVAL_BASE_URL ?? 'http://localhost:4101').origin}`,
    ],
  },
});

interface Appointment {
  id: string;
  when: string;
  startsAt: string;
  slotId: string;
}

// These helpers only drive the screens. Each call belongs to a person's step below.
async function book(page: Page, date: string, phone = ''): Promise<Appointment> {
  await showDay(page, date);
  // Leave the first time free for the owner's existing working-day checks.
  const slot = page.getByTestId('slot-link').last();
  await expect(slot).toBeVisible();
  const slotId = (await slot.getAttribute('data-slot-id')) ?? '';
  const startsAt = (await slot.getAttribute('data-starts-at')) ?? '';
  await slot.click();
  const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  await page.getByTestId('book-phone').fill(phone);
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  const row = bookingRow(page, 'upcoming-bookings', when);
  await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  const id = (await row.getAttribute('data-booking-id')) ?? '';
  expect(id).not.toBe('');
  return { id, when, startsAt, slotId };
}

async function move(page: Page, appointment: Appointment): Promise<Appointment> {
  await page.getByTestId('nav-my-bookings').click();
  await expect(page).toHaveURL(/\/bookings$/);
  await bookingRow(page, 'upcoming-bookings', appointment.when).getByTestId('reschedule-link').click();
  const target = page.getByTestId('reschedule-to').last();
  await expect(target).toBeVisible();
  const when = ((await target.textContent()) ?? '').trim();
  const startsAt = (await target.getAttribute('data-starts-at')) ?? '';
  const slotId = (await target.getAttribute('data-slot-id')) ?? '';
  await target.click();
  await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
  await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
  return { ...appointment, when, startsAt, slotId };
}

async function openDetails(page: Page, appointment: Appointment): Promise<string> {
  await bookingRow(page, 'upcoming-bookings', appointment.when).getByTestId('add-to-calendar').click();
  await expect(page.getByRole('heading', { name: 'Add to calendar', exact: true })).toBeVisible();
  await expect(page.getByLabel('Calendar details', { exact: true })).toBeVisible();
  return page.getByTestId('calendar-details').inputValue();
}

async function returnToBookings(page: Page): Promise<void> {
  await page.getByTestId('calendar-back').click();
  // Wait for client-side navigation before reloading, or the calendar page
  // itself can be reloaded while the link's navigation is still pending.
  await expect(page).toHaveURL(/\/bookings$/);
  await expect(page.getByRole('heading', { name: 'My bookings', exact: true })).toBeVisible();
}

// Traverse the actual client navigation history without a reload or fresh visit.
async function backToCalendar(page: Page, path: string): Promise<void> {
  for (let visits = 0; visits < 6; visits++) {
    await page.goBack();
    if (new URL(page.url()).pathname === path) break;
  }
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

function ukWhen(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

async function copyAndCheck(page: Page, details: string): Promise<void> {
  await page.bringToFront();
  await page.getByTestId('copy-calendar-details').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('calendar-copy-result')).toContainText('Calendar details copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(details);
}

const mailBase = () => process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';

async function receivedEmail(address: string, before: Set<string>, subject: string) {
  const unseen = async () => (await mailTo(address)).filter((m) => !before.has(m.ID) && m.Subject === subject);
  await expect.poll(async () => (await unseen()).length, { timeout: 15_000 }).toBe(1);
  const [message] = await unseen();
  if (!message) throw new Error('The confirmation email is missing');
  const response = await fetch(`${mailBase()}/api/v1/message/${encodeURIComponent(message.ID)}`);
  expect(response.ok).toBe(true);
  return (await response.json()) as { Text: string; Attachments?: unknown[] | null };
}

function checkEmail(email: { Text: string; Attachments?: unknown[] | null }, appointment: Appointment, phone: string) {
  expect(email.Text).toContain(`Start: ${appointment.when}`);
  expect(email.Text).toContain(`End: ${ukWhen(new Date(new Date(appointment.startsAt).getTime() + 45 * 60_000))}`);
  expect(email.Text).toContain('Clinic: Acme Physio');
  expect(email.Text).toContain(`With: ${PRACTITIONER}`);
  expect(email.Text).toContain('Duration: 45 minutes');
  expect(email.Text).toContain('Time zone: Europe/London');
  expect(email.Attachments ?? []).toHaveLength(0);
  if (phone) expect(email.Text).toContain(`Contact phone: ${phone}`);
  else expect(email.Text).not.toContain('Contact phone:');
}

// These journeys cover copying, clock changes, mail, privacy and refused copying.
// SMTP failure coverage lives in notifications.int.test.ts, using a local receiver
// rather than requiring failure controls on the factory's shared demo inbox.
test.setTimeout(120_000);

test('Clients can copy calendar details after booking or moving and from upcoming bookings in My bookings.', async ({
  page,
  browser,
}) => {
  const date = londonDate(24);
  const appointment = await step(page, 'Sign in on a phone and book a free session', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, PATIENT_2);
    return book(page, date);
  });
  const staff = await browser.newPage();
  try {
    const before = await step(staff, 'Find the confirmed session in the clinic diary', async () => {
      await signIn(staff, ADMIN);
      await staff.goto('/admin');
      await staff.getByTestId('admin-date').fill(date);
      await staff.getByTestId('admin-filter').click();
      const row = staff.getByTestId('admin-booking-row').filter({ hasText: appointment.when });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Confirmed');
      await expect(staff.getByTestId('add-to-calendar')).toHaveCount(0);
      return row.getByRole('cell').allTextContents();
    });
    const path = await step(page, 'Open Add to calendar and copy with both browser copy controls', async () => {
      const details = await openDetails(page, appointment);
      await copyAndCheck(page, details);
      expect(details).toContain(`Start: ${appointment.when}`);
      const fonts = await page.evaluate(async () => ({
        title: (await document.fonts.load('500 28px Fraunces')).length,
        body: (await document.fonts.load('400 16px Figtree')).length,
      }));
      expect(fonts.title).toBeGreaterThan(0);
      expect(fonts.body).toBeGreaterThan(0);
      const title = page.getByTestId('calendar-title');
      await expect(title).toHaveCSS('font-family', 'Fraunces, serif');
      await expect(title).toHaveCSS('font-weight', '500');
      await expect(title).toHaveCSS('font-size', '28px');
      await expect(page.getByTestId('calendar-details')).toHaveCSS('font-family', 'Figtree, sans-serif');
      await expect(page.getByTestId('copy-calendar-details')).toHaveCSS('font-size', '15px');
      await expect(page.getByTestId('clinic-name')).toHaveCSS('font-family', 'Fraunces, serif');
      await expect(page.getByTestId('clinic-name')).toHaveCSS('font-weight', '500');
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(title).toHaveCSS('font-size', '32px');
      await page.setViewportSize({ width: 375, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.getByTestId('calendar-update-help')).toContainText('update or remove the existing event');
      await expect(page.getByTestId('calendar-update-help')).toContainText('BookIt does not update your calendar.');
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      });
      try {
        await page.getByTestId('copy-calendar-details').press('Enter');
        await expect(page.getByTestId('calendar-copy-result')).toHaveText('Calendar details copied.');
        await expect(page.getByTestId('copy-calendar-details')).toBeFocused();
      } finally {
        await page.evaluate(() => Reflect.deleteProperty(navigator, 'clipboard'));
      }
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(details);
      return new URL(page.url()).pathname;
    });
    await step(page, 'Return later and copy again without changing the booking or clinic diary', async () => {
      await returnToBookings(page);
      await page.reload();
      const row = bookingRow(page, 'upcoming-bookings', appointment.when);
      await expect(row).toHaveAttribute('data-booking-id', appointment.id);
      await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
      const details = await openDetails(page, appointment);
      await copyAndCheck(page, details);
      await copyAndCheck(page, details);
      await staff.reload();
      const diaryRow = staff.getByTestId('admin-booking-row').filter({ hasText: appointment.when });
      await expect(diaryRow).toHaveCount(1);
      await expect(diaryRow.getByRole('cell')).toHaveText(before);
      await expect(staff.getByTestId('admin-settings-link')).toBeVisible();
      await expect(staff.getByTestId('add-to-calendar')).toHaveCount(0);
    });
    const moved = await step(
      page,
      'Move the session and see the new time and manual calendar update reminder',
      async () => {
        const moved = await move(page, appointment);
        await expect(page.getByTestId('calendar-update-help')).toContainText('BookIt does not update your calendar.');
        await expect(bookingRow(page, 'upcoming-bookings', moved.when)).toHaveAttribute(
          'data-booking-id',
          appointment.id,
        );
        return moved;
      },
    );
    await step(page, 'Use browser Back to revisit the earlier summary and copy the saved new time', async () => {
      await backToCalendar(page, path);
      const details = await page.getByTestId('calendar-details').inputValue();
      await copyAndCheck(page, details);
      expect(details).toContain(`Start: ${moved.when}`);
      expect(details).not.toContain(`Start: ${appointment.when}`);
      await expect(page.getByTestId('calendar-update-help')).toContainText('update or remove the existing event');
      expect(await slotOffered(page, date, appointment.slotId)).toBe(true);
      await page.getByTestId('nav-my-bookings').click();
      await expect(page).toHaveURL(/\/bookings$/);
      expect(await openDetails(page, moved)).toBe(details);
    });
    await step(page, 'Cancel the session and use browser Back to see that its earlier summary is refused', async () => {
      await returnToBookings(page);
      await bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('cancel-booking').click();
      const row = bookingRow(page, 'other-bookings', moved.when);
      await expect(row.getByTestId('booking-status')).toHaveText('Cancelled');
      await expect(row.getByTestId('add-to-calendar')).toHaveCount(0);
      await backToCalendar(page, path);
      await expect(page.getByTestId('not-found')).toBeVisible();
      await expect(page.getByTestId('calendar-details')).toHaveCount(0);
    });
  } finally {
    await staff.close();
  }
});

test('Booking and move emails include current calendar details without attachments and preserve optional-phone behaviour.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client who has no phone on file', async () => signIn(page, PATIENT_2));
  for (const summer of [false, true]) {
    const phone = summer ? '+44 7700 900123' : '';
    const { appointment, before } = await step(
      page,
      `Book a UK ${summer ? 'summer session with an optional phone' : 'winter session without a phone'}`,
      async () => {
        const before = new Set((await mailTo(PATIENT_2)).map((m) => m.ID));
        const appointment = await book(page, dateInPeriod(summer, 35), phone);
        return { appointment, before };
      },
    );
    await step(page, `Check the saved ${summer ? 'summer' : 'winter'} calendar details and booking email`, async () => {
      await page.reload();
      const details = await openDetails(page, appointment);
      expect(details).toBe(
        [
          `Title: Acme Physio with ${PRACTITIONER}`,
          'Clinic: Acme Physio',
          `With: ${PRACTITIONER}`,
          `Start: ${ukWhen(new Date(appointment.startsAt))}`,
          `End: ${ukWhen(new Date(new Date(appointment.startsAt).getTime() + 45 * 60_000))}`,
          `Time zone: Europe/London (${summer ? 'BST' : 'GMT'})`,
          'Duration: 45 minutes',
        ].join('\n'),
      );
      const email = await receivedEmail(PATIENT_2, before, `Booking confirmed: ${appointment.when}`);
      checkEmail(email, appointment, phone);
      expect(email.Text.replace(/\r\n/g, '\n')).toContain(details);
    });
    await step(
      page,
      `Move the ${summer ? 'summer' : 'winter'} session and read its current calendar details by email`,
      async () => {
        const before = new Set((await mailTo(PATIENT_2)).map((m) => m.ID));
        const moved = await move(page, appointment);
        const email = await receivedEmail(PATIENT_2, before, `Booking moved: ${moved.when}`);
        checkEmail(email, moved, phone);
        expect(email.Text).not.toContain(`Start: ${appointment.when}`);
        expect(email.Text).toContain('update or remove the existing calendar event yourself');
        expect(email.Text.replace(/\r\n/g, '\n')).toContain(await openDetails(page, moved));
      },
    );
  }
});

async function checkManualCopy(page: Page, details: string) {
  await page.getByTestId('copy-calendar-details').click();
  await expect(page.getByTestId('calendar-copy-result')).toContainText(
    'Copy the selected text yourself, or type the details into your calendar.',
  );
  const field = page.getByTestId('calendar-details');
  await expect(field).toBeFocused();
  expect(
    await field.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe(details);
  await expect(page.getByTestId('calendar-manual-help')).toBeVisible();
}

test('Only the booking client can retrieve their calendar summary, which excludes their personal contact details and private links.', async ({
  page,
  browser,
}) => {
  const appointment = await step(page, 'Sign in and book a session with an optional contact phone', async () => {
    await signIn(page, PATIENT_2);
    return book(page, londonDate(28), '+44 7700 900123');
  });
  const path = await step(page, 'See only event details and a manual alternative when copying is refused', async () => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Copying is unavailable')) },
      });
      Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    });
    const details = await openDetails(page, appointment);
    expect(details).toContain('Clinic: Acme Physio');
    expect(details).not.toMatch(/900123|Łukasz|Wiśniewski|@|https?:|\/bookings|reset-password|token/i);
    expect(details).not.toContain(appointment.id);
    await page.reload();
    await checkManualCopy(page, details);
    return new URL(page.url()).pathname;
  });
  const other = await browser.newPage();
  try {
    await step(other, 'Try opening that calendar summary while signed out', async () => {
      await other.goto(path);
      await expect(other).toHaveURL(/\/auth\/sign-in$/);
      await expect(other.getByTestId('calendar-details')).toHaveCount(0);
    });
    await step(other, 'Sign in as another client and try the same private summary', async () => {
      await signIn(other, PATIENT_3);
      await other.goto(path);
      await expect(other.getByTestId('not-found')).toBeVisible();
      await expect(other.getByTestId('calendar-details')).toHaveCount(0);
      await expect(other.locator('body')).not.toContainText(appointment.when);
    });
    await step(other, 'Sign in as staff and check that the client calendar summary stays private', async () => {
      await other.getByTestId('sign-out').click();
      await signIn(other, ADMIN);
      await other.goto(path);
      await expect(other).toHaveURL(new URL('/', other.url()).href);
      await expect(other.getByTestId('admin-home')).toBeVisible();
      await expect(other.getByTestId('calendar-details')).toHaveCount(0);
    });
    await step(page, 'Move the session and retrieve the saved new time even when copying fails', async () => {
      const moved = await move(page, appointment);
      await page.reload();
      await expect(bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
      const details = await openDetails(page, moved);
      await page.reload();
      await checkManualCopy(page, details);
      expect(details).toContain(`Start: ${moved.when}`);
      expect(details).not.toContain(`Start: ${appointment.when}`);
      expect(details).not.toMatch(/900123|Łukasz|Wiśniewski|@|https?:|\/bookings|reset-password|token/i);
      expect(details).not.toContain(appointment.id);
    });
  } finally {
    await other.close();
  }
});
