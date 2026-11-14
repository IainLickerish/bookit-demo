import { expect, test, type Locator, type Page } from '@playwright/test';
import { bookingRow, demoPassword, londonDate, signIn, step } from './support';
import {
  bookReminderTime,
  closeJourneys,
  confirmWithDoublePress,
  emailLinks,
  isLateCancellation,
  openJourneys,
  receiveReminder,
  revisitSavedResult,
} from './reminder-support';

async function privateDetailsHidden(page: Page) {
  for (const id of ['review-current', 'current-when', 'confirm-change', 'reschedule-to']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
}

async function touchArea(control: Locator) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box, 'the control has a touch area').not.toBeNull();
  expect(box!.height, 'the touch area is at least 44px high (DS-5)').toBeGreaterThanOrEqual(44);
  expect(box!.width, 'the touch area is at least 44px wide (DS-5)').toBeGreaterThanOrEqual(44);
  return box!;
}

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
            isLateCancellation(j)
              ? 'This will be recorded as a late cancellation.'
              : 'This is outside the late-cancellation window.',
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
        await j.visitor.getByTestId('sign-out').click();
        await expect(j.visitor).toHaveURL(/\/auth\/sign-in$/);
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
    await step(
      page,
      'Use roomy day controls and the way back on a small phone without changing the booking',
      async () => {
        for (const j of journeys) {
          await j.page.goto(j.links!.move);
          await expect(j.page.getByTestId('current-when')).toContainText(j.booked!.when);
          await j.page.getByTestId('date-input').fill(londonDate(3));
          await j.page.getByTestId('show-slots').click();
          const originalDate = await j.page.getByTestId('date-input').inputValue();
          const heading = await j.page.getByTestId('shown-date').boundingBox();
          expect(heading).not.toBeNull();
          const previous = await touchArea(j.page.getByTestId('previous-day'));
          const next = await touchArea(j.page.getByTestId('next-day'));
          expect(previous.y - (heading!.y + heading!.height), 'space below the date').toBeGreaterThanOrEqual(8);
          expect(next.y - (heading!.y + heading!.height), 'space below the date').toBeGreaterThanOrEqual(8);
          expect(next.x - (previous.x + previous.width), 'space between day controls').toBeGreaterThanOrEqual(8);
          await j.page.getByTestId('previous-day').focus();
          await j.page.keyboard.press('Tab');
          await expect(j.page.getByTestId('next-day')).toBeFocused();
          await expect(j.page.getByTestId('next-day')).toHaveCSS('outline-style', 'solid');
          await j.page.keyboard.press('Enter');
          await expect(j.page.getByTestId('date-input')).not.toHaveValue(originalDate);
          await j.page.getByTestId('previous-day').click();
          await expect(j.page.getByTestId('date-input')).toHaveValue(originalDate);
          await touchArea(j.page.getByTestId('reschedule-back'));
          expect(await j.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          await j.page.getByTestId('reschedule-back').click();
          await expect(
            bookingRow(j.page, 'upcoming-bookings', j.booked!.when).getByTestId('booking-status'),
          ).toHaveText('Confirmed');
        }
      },
    );
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
    await step(
      page,
      'Double press to confirm the move and see the saved time after refresh and back and forward',
      async () => {
        for (const j of journeys) {
          await confirmWithDoublePress(j.page, 'confirm-change', /\/bookings\?notice=rescheduled$/);
          await revisitSavedResult(j.page);
          await expect(bookingRow(j.page, 'upcoming-bookings', j.movedWhen!).getByTestId('booking-status')).toHaveText(
            'Confirmed',
          );
        }
      },
    );
    await step(page, 'Reopen the original Cancel link and confirm cancellation of the current time', async () => {
      for (const j of journeys) {
        await j.page.goto(j.links!.cancel);
        await expect(j.page.getByTestId('review-current')).toContainText(j.movedWhen!);
        await expect(j.page.getByTestId('review-current')).not.toContainText(j.booked!.when);
        await expect(j.page.getByTestId('review-consequences')).toContainText('No further reminder');
        await expect(j.page.getByTestId('review-consequences')).toContainText(
          'This is outside the late-cancellation window.',
        );
        await confirmWithDoublePress(j.page, 'confirm-change', /\/bookings\?notice=cancelled$/);
        await revisitSavedResult(j.page);
        await expect(bookingRow(j.page, 'other-bookings', j.movedWhen!).getByTestId('booking-status')).toHaveText(
          'Cancelled',
        );
      }
    });
  } finally {
    await closeJourneys(journeys);
  }
});
