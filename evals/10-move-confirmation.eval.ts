import { expect, test } from '@playwright/test';
import { PATIENT_2, PRACTITIONER, bookSlot, bookingRow, londonDate, mailTo, showDay, signIn, step } from './support';

interface ConfirmationEmail {
  To: { Address: string }[];
  Text: string;
  Subject: string;
}

async function confirmationsFor(reference: string, seen: string[] = []): Promise<ConfirmationEmail[]> {
  const mailBase = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  const messages = (await mailTo(PATIENT_2)).filter((message) => !seen.includes(message.ID));
  const emails = await Promise.all(
    messages.map(async (message) => {
      const response = await fetch(`${mailBase}/api/v1/message/${message.ID}`);
      expect(response.ok).toBe(true);
      return (await response.json()) as ConfirmationEmail;
    }),
  );
  return emails.filter((email) => email.Text.includes(`Booking reference: ${reference}`));
}

test('Moving a booking sends the client one email saying it was moved with the new day, date, time and practitioner', async ({
  page,
}) => {
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
      const reference = (await row.getAttribute('data-booking-id')) ?? '';
      expect(reference).not.toBe('');
      await expect
        .poll(async () => (await confirmationsFor(reference)).some((email) => email.Subject.includes(originalWhen)))
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
    await expect.poll(async () => (await confirmationsFor(reference, seen)).length, { timeout: 15_000 }).toBe(1);
    const emails = await confirmationsFor(reference, seen);
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.To.map((recipient) => recipient.Address)).toEqual([PATIENT_2]);
    expect(email.Subject).toContain('Booking moved:');
    expect(email.Text).toContain('Your booking at Acme Physio has been moved.');
    expect(email.Subject).toContain(movedWhen);
    expect(email.Text).toContain(`When: ${movedWhen} (Europe/London)`);
    expect(email.Text).toContain(`With: ${PRACTITIONER}`);
    expect(email.Text).toContain(`Booking reference: ${reference}`);
    expect(email.Text).not.toContain(originalWhen);
  });

  await step(page, 'Cancel the test session and see its cancelled status', async () => {
    await bookingRow(page, 'upcoming-bookings', movedWhen).getByTestId('cancel-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
    await expect(bookingRow(page, 'other-bookings', movedWhen).getByTestId('booking-status')).toHaveText('Cancelled');
  });
});
