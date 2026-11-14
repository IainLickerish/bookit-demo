import { expect, test, type Browser, type Page } from '@playwright/test';
import { bookingRow, demoPassword, londonDate, signIn, step } from './support';
import {
  bookReminderTime,
  observeReminderPolls,
  receiveReminder,
  reminderClinics,
  reminderMessages,
  type ReminderClinic,
} from './reminder-support';

function emailLinks(text: string, bookingId: string) {
  const move = /^Reschedule: (\S+)$/m.exec(text)?.[1];
  const cancel = /^Cancel: (\S+)$/m.exec(text)?.[1];
  expect(move).toBeTruthy();
  expect(cancel).toBeTruthy();
  // Like recovery checks, follow the actual email's paths in the supplied
  // copy. Its public origin can differ from the factory's forwarded address.
  expect(new URL(move!).pathname).toBe(`/bookings/${bookingId}/reschedule`);
  expect(new URL(cancel!).pathname).toBe(`/bookings/${bookingId}/review`);
  expect(new URL(move!).origin).toBe(new URL(cancel!).origin);
  return { move: new URL(move!).pathname, cancel: new URL(cancel!).pathname };
}

async function privateDetailsHidden(page: Page) {
  for (const id of ['review-current', 'current-when', 'confirm-change', 'reschedule-to']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
}

type Journey = {
  clinic: ReminderClinic;
  page: Page;
  visitor: Page;
  booked?: Awaited<ReturnType<typeof bookReminderTime>>;
  links?: ReturnType<typeof emailLinks>;
  movedWhen?: string;
};

async function openJourneys(browser: Browser, baseURL: string): Promise<Journey[]> {
  const journeys: Journey[] = [];
  for (const clinic of reminderClinics(baseURL)) {
    const options = { baseURL: clinic.baseURL, viewport: { width: 390, height: 844 } };
    const context = await browser.newContext(options);
    const visitorContext = await browser.newContext(options);
    journeys.push({ clinic, page: await context.newPage(), visitor: await visitorContext.newPage() });
  }
  return journeys;
}

async function closeJourneys(journeys: Journey[]) {
  for (const j of journeys) {
    await j.visitor.context().close();
    await j.page.context().close();
  }
}

test('Reminders show the clinic, practitioner, duration and UK appointment date and time, with Reschedule and Cancel links and no phone number.', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  const journeys = await openJourneys(browser, baseURL!);
  const page = journeys[0]!.page;
  try {
    await step(page, 'Book a confirmed time about 24 hours ahead', async () => {
      for (const j of journeys) {
        await signIn(j.page, `patient3@patients.${j.clinic.domain}`);
        j.booked = await bookReminderTime(j.page, j.clinic);
      }
    });
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
        await j.page.getByTestId('confirm-change').click();
        await expect(j.page).toHaveURL(/\/bookings\?notice=cancelled$/);
        await expect(bookingRow(j.page, 'other-bookings', j.booked!.when).getByTestId('booking-status')).toContainText(
          'Cancelled',
        );
      }
    });
  } finally {
    await closeJourneys(journeys);
  }
});

test('Reminder links require sign-in, protect booking privacy and show current details and consequences before a client confirms a change.', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  const journeys = await openJourneys(browser, baseURL!);
  const page = journeys[0]!.page;
  try {
    await step(page, 'Book a time and receive its reminder email', async () => {
      for (const j of journeys) {
        await signIn(j.page, `patient3@patients.${j.clinic.domain}`);
        j.booked = await bookReminderTime(j.page, j.clinic);
        const message = await receiveReminder(j.clinic, j.booked.bookingId);
        j.links = emailLinks(message.Text, j.booked.bookingId);
      }
    });
    await step(
      journeys[0]!.visitor,
      'Open both reminder links signed out and see sign-in without booking details',
      async () => {
        for (const j of journeys) {
          for (const link of [j.links!.move, j.links!.cancel]) {
            await j.visitor.goto(link);
            await expect(j.visitor).toHaveURL(/\/auth\/sign-in\?next=/);
            await privateDetailsHidden(j.visitor);
          }
        }
      },
    );
    await step(
      journeys[0]!.visitor,
      'Sign in from the reminder and review the current booking before any change',
      async () => {
        for (const j of journeys) {
          await j.visitor.getByTestId('sign-in-email').fill(`patient3@patients.${j.clinic.domain}`);
          await j.visitor.getByTestId('sign-in-password').fill(demoPassword());
          await j.visitor.getByTestId('sign-in-submit').click();
          await expect(j.visitor.getByTestId('review-current')).toContainText(j.booked!.when);
          await expect(j.visitor.getByTestId('review-current')).toContainText(j.clinic.practitioner);
          await expect(j.visitor.getByTestId('review-current')).toContainText(`${j.clinic.minutes} minutes`);
          await expect(j.visitor.getByTestId('review-consequences')).toContainText('Cancelling releases your time');
          await expect(j.visitor.getByTestId('review-consequences')).toContainText(
            'This will be recorded as a late cancellation.',
          );
          await j.visitor.getByTestId('confirm-change').focus();
          await expect(j.visitor.getByTestId('confirm-change')).toBeFocused();
          await j.visitor.getByTestId('review-back').click();
          await expect(
            bookingRow(j.visitor, 'upcoming-bookings', j.booked!.when).getByTestId('booking-status'),
          ).toHaveText('Confirmed');
        }
      },
    );
    await step(journeys[0]!.visitor, 'See that another client cannot use either reminder link', async () => {
      for (const j of journeys) {
        await signIn(j.visitor, `patient2@patients.${j.clinic.domain}`);
        for (const link of [j.links!.move, j.links!.cancel]) {
          await j.visitor.goto(link);
          await privateDetailsHidden(j.visitor);
          await expect(j.visitor.getByText(j.booked!.when, { exact: true })).toHaveCount(0);
        }
        for (const other of journeys.filter((other) => other !== j)) {
          // These clients are signed in to separate supplied clinic copies.
          for (const link of [j.links!.move, j.links!.cancel]) {
            await other.page.goto(link);
            await privateDetailsHidden(other.page);
          }
        }
      }
    });
    await step(page, 'Use the emailed Reschedule link to choose a new time and review the change', async () => {
      for (const j of journeys) {
        await j.page.goto(j.links!.move);
        await expect(j.page.getByTestId('current-when')).toContainText(j.booked!.when);
        await j.page.getByTestId('date-input').fill(londonDate(3));
        await j.page.getByTestId('show-slots').click();
        const target = j.page.getByTestId('reschedule-to').last();
        j.movedWhen = (await target.textContent())!.trim();
        await target.click();
        await expect(j.page.getByTestId('review-current')).toContainText(j.booked!.when);
        await expect(j.page.getByTestId('review-new')).toContainText(j.movedWhen);
        await expect(j.page.getByTestId('review-new')).toContainText(`${j.clinic.minutes} minutes`);
        await expect(j.page.getByTestId('review-consequences')).toContainText(
          'Your old time is released only when the new time is secured',
        );
      }
    });
    await step(page, 'Confirm the move and see the new time in My bookings', async () => {
      for (const j of journeys) {
        await j.page.getByTestId('confirm-change').click();
        await expect(j.page).toHaveURL(/\/bookings\?notice=rescheduled$/);
        await expect(bookingRow(j.page, 'upcoming-bookings', j.movedWhen!).getByTestId('booking-status')).toHaveText(
          'Confirmed',
        );
      }
    });
    await step(page, 'Reopen the original Cancel link and confirm cancellation of the current time', async () => {
      for (const j of journeys) {
        await j.page.goto(j.links!.cancel);
        await expect(j.page.getByTestId('review-current')).toContainText(j.movedWhen!);
        await expect(j.page.getByTestId('review-current')).not.toContainText(j.booked!.when);
        await expect(j.page.getByTestId('review-consequences')).toContainText('No further reminder');
        await expect(j.page.getByTestId('review-consequences')).toContainText(
          'This is outside the late-cancellation window.',
        );
        await j.page.getByTestId('confirm-change').click();
        await expect(j.page).toHaveURL(/\/bookings\?notice=cancelled$/);
        await expect(bookingRow(j.page, 'other-bookings', j.movedWhen!).getByTestId('booking-status')).toHaveText(
          'Cancelled',
        );
      }
    });
  } finally {
    await closeJourneys(journeys);
  }
});
