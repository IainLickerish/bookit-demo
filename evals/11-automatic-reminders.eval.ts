import { expect, test } from '@playwright/test';
import { bookingRow, signIn, step } from './support';
import {
  bookReminderTime,
  closeJourneys,
  emailLinks,
  isLateCancellation,
  observeReminderPolls,
  openJourneys,
  receiveReminder,
  reminderMessages,
} from './reminder-support';

test('Reminders show the clinic, practitioner, duration and UK appointment date and time, with Reschedule and Cancel links and no phone number.', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  const journeys = await openJourneys(browser, baseURL!);
  const page = journeys[0]!.page;
  try {
    await step(
      page,
      'Double press to book a time about 24 hours ahead, then refresh and go back and forward',
      async () => {
        for (const j of journeys) {
          await signIn(j.page, `patient3@patients.${j.clinic.domain}`);
          j.booked = await bookReminderTime(j.page, j.clinic);
        }
      },
    );
    await step(page, 'Read the automatically delivered reminder with UK time and private change links', async () => {
      for (const j of journeys) {
        const message = await receiveReminder(j.clinic, j.booked!.bookingId);
        const expectedWhen = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/London',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(j.booked!.startsAt);
        expect(message.Subject).toBe(`Reminder: your ${j.clinic.appointment} at ${j.clinic.name}`);
        expect(message.Text.startsWith(`${j.clinic.name}\n`)).toBe(true);
        expect(message.Text).toContain(`When: ${expectedWhen} (UK time, Europe/London)`);
        expect(message.Text).toContain(`Your ${j.clinic.practitionerWord}: ${j.clinic.practitioner}`);
        expect(message.Text).toContain(`Duration: ${j.clinic.minutes} minutes`);
        expect(message.Text).not.toMatch(/phone|7700|\+44/i);
        await test.info().attach(`${j.clinic.name} reminder`, { body: message.Text, contentType: 'text/plain' });
        j.links = emailLinks(message.Text, j.booked!.bookingId);
      }
    });
    await step(page, 'Wait through repeated automatic checks and still find exactly one reminder', async () => {
      await observeReminderPolls(async () => {
        for (const j of journeys) {
          expect(
            await reminderMessages(j.clinic.mailURL, `patient3@patients.${j.clinic.domain}`, j.booked!.bookingId),
          ).toHaveLength(1);
        }
      });
    });
    await step(page, 'Cancel the test booking after checking its details and consequences', async () => {
      for (const j of journeys) {
        await j.page.goto(j.links!.cancel);
        await expect(j.page.getByTestId('review-current')).toContainText(j.booked!.when);
        await expect(j.page.getByTestId('review-consequences')).toContainText('No further reminder');
        const late = isLateCancellation(j);
        await expect(j.page.getByTestId('review-consequences')).toContainText(
          late ? 'This will be recorded as a late cancellation.' : 'This is outside the late-cancellation window.',
        );
        await j.page.getByTestId('confirm-change').click();
        await expect(j.page).toHaveURL(
          new URL(`/bookings?notice=${late ? 'cancelled_late' : 'cancelled'}`, j.clinic.baseURL).href,
        );
        await expect(j.page.getByTestId('notice')).toHaveText(
          late ? 'Booking cancelled. This was a late cancellation.' : 'Booking cancelled.',
        );
        await expect(bookingRow(j.page, 'other-bookings', j.booked!.when).getByTestId('booking-status')).toContainText(
          'Cancelled',
        );
      }
    });
  } finally {
    await closeJourneys(journeys);
  }
});
