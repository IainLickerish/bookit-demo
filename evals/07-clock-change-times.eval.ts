import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  bookSlot,
  bookingRow,
  dateInPeriod,
  givePhone,
  mailTo,
  sessionFor,
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

async function offeredAppointment(page: Page, date: string) {
  await showDay(page, date);
  // Leave the first appointment free for the existing working-day check.
  const slot = page.getByTestId('slot-link').last();
  await expect(slot).toBeVisible();
  const id = (await slot.getAttribute('data-slot-id')) ?? '';
  const startsAt = (await slot.getAttribute('data-starts-at')) ?? '';
  expect(id).not.toBe('');
  return { id, startsAt, when: ukWhen(startsAt) };
}

test('Available appointments still start at 09:00 UK time and show the correct UK date and time in both winter and summer.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_1);
  });
  for (const summer of [false, true]) {
    await step(page, `See free sessions starting at 09:00 in UK ${summer ? 'summer' : 'winter'} time`, async () => {
      await showDay(page, dateInPeriod(summer, 3));
      const slots = page.getByTestId('slot-link');
      await expect(slots.first()).toBeVisible();
      expect(ukWhen((await slots.first().getAttribute('data-starts-at')) ?? '')).toMatch(/09:00$/);
      for (const slot of await slots.all()) {
        const instant = (await slot.getAttribute('data-starts-at')) ?? '';
        await expect(slot).toHaveText(ukWhen(instant));
      }
    });
  }
});

test('Clients see the correct UK date and time when reviewing a booking, in My bookings and when choosing a new time, in both winter and summer.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_1);
  });
  for (const summer of [false, true]) {
    const appointment = await step(page, `Review a session in UK ${summer ? 'summer' : 'winter'} time`, async () => {
      const appointment = await offeredAppointment(page, dateInPeriod(summer, 3));
      await page.goto(`/book/${appointment.id}`);
      await expect(page.getByTestId('book-when')).toHaveText(`${appointment.when} (45 minutes)`);
      return appointment;
    });
    const row = await step(
      page,
      `Confirm the ${summer ? 'summer' : 'winter'} session and see it in My bookings`,
      async () => {
        await givePhone(page);
        await page.getByTestId('confirm-booking').click();
        await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
        await page.reload();
        const row = bookingRow(page, 'upcoming-bookings', appointment.when);
        await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
        return row;
      },
    );
    await step(page, `Move the ${summer ? 'summer' : 'winter'} session and see the new UK time`, async () => {
      await row.getByTestId('reschedule-link').click();
      await expect(page.getByTestId('current-when')).toHaveText(appointment.when);
      const choices = page.getByTestId('reschedule-to');
      await expect(choices.first()).toBeVisible();
      for (const choice of await choices.all()) {
        await expect(choice).toHaveText(ukWhen((await choice.getAttribute('data-starts-at')) ?? ''));
      }
      const target = choices.last();
      const movedWhen = ukWhen((await target.getAttribute('data-starts-at')) ?? '');
      await target.click();
      await expect(page.getByTestId('review-new')).toContainText(movedWhen);
      await page.getByTestId('confirm-change').click();
      await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
      await expect(bookingRow(page, 'upcoming-bookings', movedWhen).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
    });
  }
});

test('Confirmation emails show the correct UK date and time for winter and summer appointments.', async ({ page }) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_1);
  });
  for (const summer of [false, true]) {
    const { appointment, before } = await step(
      page,
      `Book a session in UK ${summer ? 'summer' : 'winter'} time`,
      async () => {
        const appointment = await offeredAppointment(page, dateInPeriod(summer, 3));
        const before = new Set((await mailTo(PATIENT_1)).map((message) => message.ID));
        await bookSlot(page, appointment.id);
        return { appointment, before };
      },
    );
    await step(page, `Receive a confirmation email showing the UK ${summer ? 'summer' : 'winter'} time`, async () => {
      const newMessages = async () => (await mailTo(PATIENT_1)).filter((message) => !before.has(message.ID));
      await expect.poll(async () => (await newMessages()).length, { timeout: 15_000 }).toBe(1);
      const [message] = await newMessages();
      if (!message) throw new Error('The booking confirmation email is missing');
      expect(message.Subject).toBe(`Booking confirmed: ${appointment.when}`);
      const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
      const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
      expect(response.ok).toBe(true);
      const email = (await response.json()) as { Text: string };
      expect(email.Text).toContain(`When: ${appointment.when} (Europe/London)`);
    });
  }
});

test('Staff see the correct UK date and time for winter and summer bookings.', async ({ browser }) => {
  const patient = await sessionFor(browser, PATIENT_1);
  const staff = await sessionFor(browser, ADMIN);
  for (const summer of [false, true]) {
    const date = dateInPeriod(summer, 3);
    const appointment = await step(patient, `Book a session in UK ${summer ? 'summer' : 'winter'} time`, async () => {
      const appointment = await offeredAppointment(patient, date);
      await bookSlot(patient, appointment.id);
      return appointment;
    });
    await step(staff, `Find the ${summer ? 'summer' : 'winter'} booking as staff and see its UK time`, async () => {
      await staff.goto('/admin');
      await staff.getByTestId('admin-date').fill(date);
      await staff.getByTestId('admin-filter').click();
      await expect(staff.getByTestId('admin-booking-row').filter({ hasText: appointment.when })).toHaveCount(1);
    });
  }
  await patient.context().close();
  await staff.context().close();
});
