import { expect, test, type Response } from '@playwright/test';
import { PATIENT_3, PRACTITIONER, londonDate, mailTo, pickFreeSlot, signIn, step } from './support';

test('Rapidly confirming twice shows Booking confirmed and one matching confirmed booking without an unavailable error', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_3);
  });
  const when = await step(page, 'Choose a free session and check its details', async () => {
    const slot = await pickFreeSlot(page, londonDate(24));
    await page.getByTestId('slot-link').filter({ hasText: slot.time }).click();
    await expect(page.getByTestId('book-practitioner')).toHaveText(PRACTITIONER);
    return ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  });
  await step(page, 'Press Confirm booking twice in quick succession', async () => {
    const responses: Response[] = [];
    const onResponse = (response: Response) => {
      const request = response.request();
      if (request.method() === 'POST') {
        responses.push(response);
      }
    };
    page.on('response', onResponse);
    // Wait for React to attach the form before dispatching both clicks together.
    // Otherwise the browser can coalesce two native navigations into one POST.
    await expect
      .poll(() =>
        page
          .getByTestId('confirm-booking')
          .evaluate((button) => Object.keys(button).some((key) => key.startsWith('__reactProps$'))),
      )
      .toBe(true);
    // Dispatch both clicks together so navigation cannot remove the form between them.
    await page.getByTestId('confirm-booking').evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => responses.length, { message: 'both confirmation responses arrive' }).toBe(2);
    page.off('response', onResponse);
    for (const response of responses) {
      expect(
        await test.step('The confirmation response finishes', () => response.finished(), { timeout: 10_000 }),
        'the confirmation response completes',
      ).toBeNull();
      const redirect = (await response.headerValue('x-action-redirect')) ?? (await response.headerValue('location'));
      expect(redirect, 'each confirmation redirects to the saved booking').toMatch(
        /^(?:https?:\/\/[^/]+)?\/bookings\?notice=booked(?:;push)?$/,
      );
    }
    await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
    await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(page.getByTestId('booking-error')).toHaveCount(0);
    await expect(page.getByTestId('slot-taken')).toHaveCount(0);
    const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(PRACTITIONER);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  });
  await step(page, 'Reload My bookings and see exactly one matching confirmed session', async () => {
    await page.reload();
    const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(PRACTITIONER);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  });
});

test('Repeating a saved confirmation preserves its reference, time, practitioner and status and sends no further email', async ({
  page,
  context,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_3);
  });
  const savedForm = await context.newPage();
  const when = await step(page, 'Open the same free session in two tabs', async () => {
    const slot = await pickFreeSlot(page, londonDate(25));
    await page.getByTestId('slot-link').filter({ hasText: slot.time }).click();
    await expect(page.getByTestId('book-practitioner')).toHaveText(PRACTITIONER);
    await savedForm.goto(page.url());
    await expect(savedForm.getByTestId('confirm-booking')).toBeVisible();
    return ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  });
  const row = (p: typeof page) =>
    p.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: when });
  const reference = await step(page, 'Confirm the session in the first tab', async () => {
    await page.getByTestId('book-phone').fill('+44 7700 900124');
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(row(page)).toHaveCount(1);
    const reference = await row(page).getAttribute('data-booking-id');
    expect(reference).toBeTruthy();
    return reference!;
  });
  const emailsForBooking = async () => {
    const messages = (await mailTo(PATIENT_3)).filter((message) => message.Subject === `Booking confirmed: ${when}`);
    const matches = [];
    for (const message of messages) {
      const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
      const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
      expect(response.ok).toBe(true);
      const email = (await response.json()) as { Text: string };
      if (email.Text.includes(`Booking reference: ${reference}`)) matches.push(message.ID);
    }
    return matches;
  };
  const originalEmails = await step(page, 'Receive the confirmation email for this booking', async () => {
    await expect.poll(emailsForBooking, { timeout: 15_000 }).toHaveLength(1);
    return emailsForBooking();
  });
  await step(savedForm, 'Confirm again from the other tab with a different phone number', async () => {
    await savedForm.getByTestId('book-phone').fill('+44 7700 900125');
    await savedForm.getByTestId('confirm-booking').click();
    await expect(savedForm).toHaveURL(/\/bookings\?notice=booked$/);
    await expect(savedForm.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(savedForm.getByTestId('booking-error')).toHaveCount(0);
  });
  await step(savedForm, 'See the same saved session and no further confirmation email', async () => {
    await savedForm.reload();
    await expect(row(savedForm)).toHaveCount(1);
    await expect(row(savedForm)).toHaveAttribute('data-booking-id', reference);
    await expect(row(savedForm).getByTestId('booking-when')).toHaveText(when);
    await expect(row(savedForm)).toContainText(PRACTITIONER);
    await expect(row(savedForm).getByTestId('booking-status')).toHaveText('Confirmed');
    expect(await emailsForBooking()).toEqual(originalEmails);
  });
  await savedForm.close();
});
