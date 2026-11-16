import { expect, test } from '@playwright/test';
import { PATIENT_2, PRACTITIONER, bookSlot, bookingRow, londonDate, mailTo, showDay, signIn, step } from './support';

test('Moving a booking sends the client one confirmation email with the new day, date, time and practitioner', async ({
  page,
}) => {
  const mailBase = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_2);
  });

  const { originalWhen, reference, seen } = await step(
    page,
    'Book a session and receive its first confirmation',
    async () => {
      await showDay(page, londonDate(32));
      const slot = page.getByTestId('slot-link').filter({ hasText: /14:15/ });
      await expect(slot).toBeVisible();
      const slotId = (await slot.getAttribute('data-slot-id')) ?? '';
      const originalWhen = await bookSlot(page, slotId);
      const row = bookingRow(page, 'upcoming-bookings', originalWhen);
      const reference = await row.getAttribute('data-booking-id');
      expect(reference).toBeTruthy();
      await expect
        .poll(async () => (await mailTo(PATIENT_2)).some((message) => message.Subject.includes(originalWhen)))
        .toBe(true);
      return { originalWhen, reference, seen: (await mailTo(PATIENT_2)).map((message) => message.ID) };
    },
  );

  const movedWhen = await step(page, 'Move the session to a new day and time', async () => {
    await bookingRow(page, 'upcoming-bookings', originalWhen).getByTestId('reschedule-link').click();
    await page.getByTestId('date-input').fill(londonDate(33));
    await page.getByTestId('show-slots').click();
    const target = page.getByTestId('reschedule-to').filter({ hasText: /11:15/ });
    await expect(target).toBeVisible();
    const movedWhen = (await target.innerText()).trim();
    await target.click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    const row = bookingRow(page, 'upcoming-bookings', movedWhen);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
    await expect(row).toContainText(PRACTITIONER);
    return movedWhen;
  });

  await step(page, 'Read one move confirmation addressed to you with the new details', async () => {
    const newMessages = async () => (await mailTo(PATIENT_2)).filter((message) => !seen.includes(message.ID));
    await expect.poll(async () => (await newMessages()).length, { timeout: 15_000 }).toBe(1);
    const messages = await newMessages();
    expect(messages).toHaveLength(1);
    const response = await fetch(`${mailBase}/api/v1/message/${messages[0]!.ID}`);
    expect(response.ok).toBe(true);
    const email = (await response.json()) as { To: { Address: string }[]; Text: string; Subject: string };
    expect(email.To.map((recipient) => recipient.Address)).toEqual([PATIENT_2]);
    expect(email.Subject).toContain(movedWhen);
    expect(email.Text).toContain(`When: ${movedWhen} (Europe/London)`);
    expect(email.Text).toContain(`With: ${PRACTITIONER}`);
    expect(email.Text).toContain(`Booking reference: ${reference}`);
    expect(email.Text).not.toContain(originalWhen);
  });
});
