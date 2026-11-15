import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookingRow,
  evalNow,
  londonDate,
  mailTo,
  showDay,
  signIn,
  step,
} from './support';

function ukWhen(instant: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/** Choose a free time that is upcoming and already within the reminder window. */
async function dueTime(page: Page): Promise<{ when: string; date: string }> {
  const now = evalNow().getTime();
  for (const days of [1, 0]) {
    const date = londonDate(days);
    await showDay(page, date);
    let nearest: { when: string; starts: number } | undefined;
    for (const slot of await page.getByTestId('slot-link').all()) {
      const start = (await slot.getAttribute('data-starts-at')) ?? '';
      const starts = Date.parse(start);
      if (starts > now && starts <= now + 86_400_000 && (!nearest || starts > nearest.starts)) {
        nearest = { when: ukWhen(start), starts };
      }
    }
    if (nearest) return { when: nearest.when, date };
  }
  throw new Error('The demo has no free appointment within the next 24 hours');
}

async function confirm(page: Page, when: string): Promise<string> {
  await page.getByTestId('slot-link').filter({ hasText: when }).click();
  await expect(page.getByTestId('book-phone')).toHaveValue('');
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  const row = bookingRow(page, 'upcoming-bookings', when);
  await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  const id = await row.getAttribute('data-booking-id');
  if (!id) throw new Error('The new booking has no reference');
  return id;
}

async function matchingMail(
  address: string,
  reference: string,
  subject: string,
): Promise<{ Subject: string; Text: string }[]> {
  const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  const matches: { Subject: string; Text: string }[] = [];
  for (const message of (await mailTo(address)).filter((mail) => mail.Subject.startsWith(subject))) {
    const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
    expect(response.ok, 'the email can be opened').toBe(true);
    const body = (await response.json()) as { Text: string };
    if (body.Text.includes(`Booking reference: ${reference}`))
      matches.push({ Subject: message.Subject, Text: body.Text.replace(/\r\n/g, '\n') });
  }
  return matches;
}

async function receiveReminder(address: string, reference: string) {
  await expect
    .poll(async () => (await matchingMail(address, reference, 'Booking reminder:')).length, { timeout: 25_000 })
    .toBe(1);
  const message = (await matchingMail(address, reference, 'Booking reminder:')).find((email) =>
    email.Text.includes(`Booking reference: ${reference}`),
  );
  if (!message) throw new Error('The reminder email is missing');
  return message;
}

function reminderPaths(text: string) {
  const reschedule = /^Reschedule: (https?:\/\/\S+)$/m.exec(text)?.[1];
  const cancel = /^Cancel in My bookings: (https?:\/\/\S+)$/m.exec(text)?.[1];
  if (!reschedule || !cancel) throw new Error('The reminder needs both management links');
  const urls = [new URL(reschedule), new URL(cancel)];
  expect(urls[0]!.origin).toBe(urls[1]!.origin);
  for (const url of urls) {
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.search).toBe('');
  }
  // As with resetLink in support.ts, open paths only in this demo copy.
  return { reschedule: urls[0]!.pathname, cancel: `${urls[1]!.pathname}${urls[1]!.hash}` };
}

test('A booking made less than 24 hours ahead receives a reminder with UK session details and private management links', async ({
  page,
  browser,
}) => {
  const appointment = await step(page, 'Sign in and choose a session within the next 24 hours', async () => {
    await signIn(page, PATIENT_2);
    return dueTime(page);
  });
  const reference = await step(page, 'Book the session without a phone number and see it confirmed', async () =>
    confirm(page, appointment.when),
  );
  const paths = await step(
    page,
    'Receive one reminder with the clinic, UK time, physiotherapist and both links',
    async () => {
      const email = await receiveReminder(PATIENT_2, reference);
      const clinic = (await page.getByTestId('clinic-name').textContent()) ?? '';
      expect(email.Text.split('\n')[0]?.trim()).toBe(clinic.trim());
      expect(email.Subject).toBe(`Booking reminder: ${appointment.when}`);
      expect(email.Text).toContain(`When: ${appointment.when} (UK time, Europe/London)`);
      expect(email.Text).toContain(`With: ${PRACTITIONER}, your physiotherapist`);
      expect(email.Text).toContain('your session');
      expect(email.Text).toContain('Sign in with your clinic account');
      expect(email.Text).not.toContain('Contact phone');
      return reminderPaths(email.Text);
    },
  );
  const visitor = await (await browser.newContext()).newPage();
  const stranger = await (await browser.newContext()).newPage();
  try {
    await step(visitor, 'Open each reminder link while signed out and be asked to sign in', async () => {
      for (const path of [paths.reschedule, paths.cancel]) {
        await visitor.goto(path);
        await expect(visitor).toHaveURL(/\/auth\/sign-in/);
        await expect(visitor.getByTestId('current-when')).toHaveCount(0);
        await expect(visitor.getByTestId('booking-row')).toHaveCount(0);
      }
    });
    await step(stranger, 'Open the links as another client and see none of this booking’s details', async () => {
      await signIn(stranger, PATIENT_1);
      await stranger.goto(paths.reschedule);
      await expect(stranger.getByTestId('current-when')).toHaveCount(0);
      await expect(stranger.getByTestId('reschedule-to')).toHaveCount(0);
      await stranger.goto(paths.cancel);
      await expect(bookingRow(stranger, 'upcoming-bookings', appointment.when)).toHaveCount(0);
    });
    await step(page, 'Open the links as the booking owner and find the move and cancel controls', async () => {
      await page.goto(paths.reschedule);
      await expect(page.getByTestId('current-when')).toHaveText(appointment.when);
      await page.goto(paths.cancel);
      await expect(bookingRow(page, 'upcoming-bookings', appointment.when).getByTestId('cancel-booking')).toBeVisible();
    });
  } finally {
    await visitor.context().close();
    await stranger.context().close();
  }
});

test('Clinic staff can switch reminders off and back on, releasing an unsent reminder for an upcoming booking', async ({
  page,
  browser,
}) => {
  const client = await (await browser.newContext()).newPage();
  const original = await step(page, 'Sign in as clinic staff and open the reminder switch', async () => {
    await signIn(page, ADMIN);
    await page.goto('/admin/settings');
    return page.getByTestId('admin-reminders-enabled').isChecked();
  });
  try {
    await step(page, 'Switch reminder emails off and see the saved setting after reloading', async () => {
      await page.getByTestId('admin-reminders-enabled').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('admin-reminders-enabled')).not.toBeChecked();
    });
    const booking = await step(
      client,
      'As a client, book a session within 24 hours while reminders are off',
      async () => {
        await signIn(client, PATIENT_3);
        const appointment = await dueTime(client);
        return { ...appointment, reference: await confirm(client, appointment.when) };
      },
    );
    await step(client, 'Receive the confirmation and keep reminders off while checking the inbox', async () => {
      await expect
        .poll(async () => (await matchingMail(PATIENT_3, booking.reference, 'Booking confirmed:')).length)
        .toBe(1);
      // Absence needs an observation window: keep the switch off beyond the
      // scheduler's 10-second interval, checking the inbox throughout. Use
      // elapsed test time because EVAL_NOW deliberately stays fixed.
      const observationStarted = performance.now();
      await expect
        .poll(
          async () => ({
            reminders: (await matchingMail(PATIENT_3, booking.reference, 'Booking reminder:')).length,
            observedFullInterval: performance.now() - observationStarted >= 15_000,
          }),
          {
            message: 'No reminder arrives while reminders stay off across a scheduled check',
            timeout: 20_000,
            intervals: [500],
          },
        )
        .toEqual({ reminders: 0, observedFullInterval: true });
      await client.reload();
      await expect(bookingRow(client, 'upcoming-bookings', booking.when).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
    });
    await step(page, 'Switch reminder emails back on and save the change', async () => {
      await page.getByTestId('admin-reminders-enabled').check();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    });
    await step(client, 'Receive the previously unsent reminder for that booking', async () => {
      const email = await receiveReminder(PATIENT_3, booking.reference);
      expect(email.Text).toContain(`When: ${booking.when} (UK time, Europe/London)`);
    });
  } finally {
    await step(page, 'Restore the clinic’s original reminder setting', async () => {
      await page.goto('/admin/settings');
      await page.getByTestId('admin-reminders-enabled').setChecked(original);
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
    });
    await client.context().close();
  }
});

test('Moving an unreminded booking sends its reminder for the new time', async ({ page }) => {
  const originalWhen = await step(page, 'Sign in and choose a session well beyond the reminder window', async () => {
    await signIn(page, PATIENT_2);
    await showDay(page, londonDate(31));
    const when = `${ukWhen(`${londonDate(31)}T12:00:00Z`).replace(/\d\d:\d\d$/, '')}14:15`;
    await expect(page.getByTestId('slot-link').filter({ hasText: when })).toBeVisible();
    return when;
  });
  const reference = await step(page, 'Book the later session and see it confirmed', async () =>
    confirm(page, originalWhen),
  );
  const target = await step(page, 'Choose a free session within the next 24 hours', async () => dueTime(page));
  await step(page, 'Move the booking to the earlier session and see the new time saved', async () => {
    await page.getByTestId('nav-my-bookings').click();
    await bookingRow(page, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
    await page.getByTestId('date-input').fill(target.date);
    await page.getByTestId('show-slots').click();
    await page.getByTestId('reschedule-to').filter({ hasText: target.when }).click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    await expect(bookingRow(page, 'upcoming-bookings', target.when).getByTestId('booking-status')).toHaveText(
      'Confirmed',
    );
  });
  await step(page, 'Receive a reminder for the new time, with the same booking reference', async () => {
    const email = await receiveReminder(PATIENT_2, reference);
    expect(email.Text).toContain(`When: ${target.when} (UK time, Europe/London)`);
    expect(email.Text).not.toContain(originalWhen);
  });
});
