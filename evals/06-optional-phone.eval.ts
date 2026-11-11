import { expect, test, type Page } from '@playwright/test';
import { PATIENT_2, PRACTITIONER, bookingRow, londonDate, mailTo, pickFreeSlot, signIn } from './support';

async function openBooking(page: Page, daysAhead: number): Promise<string> {
  await signIn(page, PATIENT_2);
  await pickFreeSlot(page, londonDate(daysAhead));
  await page.getByTestId('slot-link').first().click();
  // This seeded client has no phone number on file.
  await expect(page.getByTestId('book-phone')).toHaveValue('');
  return ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
}

test('A client with no phone number on file can leave the phone box empty and see a confirmed booking', async ({
  page,
}) => {
  const when = await openBooking(page, 17);
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
  await page.reload();
  await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
});

test('A client with no phone number on file can book when the phone box contains only spaces', async ({ page }) => {
  const when = await openBooking(page, 18);
  await page.getByTestId('book-phone').fill('   ');
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
});

test('A booking without a phone number sends a confirmation email with the appointment details and no contact phone line', async ({
  page,
}) => {
  const when = await openBooking(page, 19);
  const before = new Set((await mailTo(PATIENT_2)).map((message) => message.ID));
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  const reference = await bookingRow(page, 'upcoming-bookings', when).getAttribute('data-booking-id');
  expect(reference).toBeTruthy();

  const newMessages = async () => (await mailTo(PATIENT_2)).filter((message) => !before.has(message.ID));
  await expect.poll(async () => (await newMessages()).length, { timeout: 15_000 }).toBe(1);
  const [message] = await newMessages();
  if (!message) throw new Error('The booking confirmation email is missing');
  expect(message.Subject).toBe(`Booking confirmed: ${when}`);
  const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
  expect(response.ok, 'the confirmation email can be opened').toBe(true);
  const email = (await response.json()) as { Text: string };
  expect(email.Text).toContain(`When: ${when} (Europe/London)`);
  expect(email.Text).toContain(`With: ${PRACTITIONER}`);
  expect(email.Text).toContain(`Booking reference: ${reference}`);
  expect(email.Text).toContain('To cancel or reschedule, sign in to BookIt and open My bookings.');
  expect(email.Text).not.toContain('Contact phone');
});
