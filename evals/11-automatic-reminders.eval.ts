import { expect, test, type Page } from '@playwright/test';
import { bookSlot, bookingRow, demoPassword, signIn, step } from './support';
import {
  advanceReminderClock,
  observeReminderPolls,
  reminderClockChanges,
  reminderMessages,
  type ReminderMessage,
} from './reminder-support';

const clinics = [
  {
    name: 'Acme Physio',
    baseURL: process.env.EVAL_BASE_URL ?? 'http://localhost:4101',
    mailURL: process.env.EVAL_MAIL_URL ?? 'http://localhost:8025',
    patient: 'patient3@patients.acmephysio.test',
    otherPatient: 'patient2@patients.acmephysio.test',
    practitioner: 'Alex Physiotherapist',
    practitionerWord: 'physiotherapist',
    appointment: 'session',
    minutes: 45,
    cancelledStatus: 'Cancelled',
    cancellationTiming: 'This is outside the late-cancellation window.',
  },
  {
    name: 'Beacon Dental',
    baseURL: process.env.EVAL_BEACON_BASE_URL ?? 'http://localhost:4201',
    mailURL: process.env.EVAL_BEACON_MAIL_URL ?? 'http://localhost:8026',
    patient: 'patient3@patients.beacondental.test',
    otherPatient: 'patient2@patients.beacondental.test',
    practitioner: 'Blair Dentist',
    practitionerWord: 'clinician',
    appointment: 'appointment',
    minutes: 30,
    cancelledStatus: 'Cancelled (late)',
    cancellationTiming: 'This will be recorded as a late cancellation.',
  },
];

type Journey = (typeof clinics)[number] & {
  page: Page;
  when: string;
  startsAt: Date;
  bookingId: string;
  message?: ReminderMessage;
  moveURL: string;
  cancelURL: string;
  movedWhen: string;
};

const criteria = [
  'Clients in both clinics receive reminders within the agreed window before confirmed appointments, with timing correct through UK clock changes.',
  'Reminder links require sign-in, protect booking privacy and show current details and consequences before a client confirms a change.',
];

// These run last, against disposable demo copies. Clock advances are deliberately
// never undone. The standard EVAL_NOW (20 Oct 2026) includes both changes in the
// seeded 220-day horizon, and each clinic uses its own database and local inbox.
for (const [index, date] of reminderClockChanges().entries()) {
  test(criteria[index]!, async ({ browser }) => {
    test.setTimeout(240_000);
    const journeys: Journey[] = [];
    for (const clinic of clinics) {
      const context = await browser.newContext({ baseURL: clinic.baseURL, viewport: { width: 390, height: 844 } });
      journeys.push({
        ...clinic,
        page: await context.newPage(),
        when: '',
        startsAt: new Date(0),
        bookingId: '',
        moveURL: '',
        cancelURL: '',
        movedWhen: '',
      });
    }
    const page = journeys[0]!.page;
    try {
      await step(page, 'Book a confirmed time on the clock-change Sunday in each clinic', async () => {
        for (const j of journeys) {
          await signIn(j.page, j.patient);
          await j.page.getByTestId('nav-book').click();
          await j.page.getByTestId('practitioner-select').selectOption({ label: j.practitioner });
          await j.page.getByTestId('date-input').fill(date);
          await j.page.getByTestId('show-slots').click();
          const slot = j.page.getByTestId('slot-link').filter({ hasText: '09:00' }).first();
          await expect(slot).toBeVisible();
          j.startsAt = new Date((await slot.getAttribute('data-starts-at'))!);
          j.when = await bookSlot(j.page, (await slot.getAttribute('data-slot-id'))!);
          const row = bookingRow(j.page, 'upcoming-bookings', j.when);
          await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
          j.bookingId = (await row.getAttribute('data-booking-id'))!;
          expect(j.bookingId).not.toBe('');
        }
        expect(journeys[0]!.startsAt.getTime()).toBe(journeys[1]!.startsAt.getTime());
      });
      await step(page, 'See no reminder just before the 24-hour window opens', async () => {
        advanceReminderClock(new Date(journeys[0]!.startsAt.getTime() - 24 * 3_600_000 - 1));
        await observeReminderPolls(async () => {
          for (const j of journeys) expect(await reminderMessages(j.mailURL, j.patient, j.bookingId)).toHaveLength(0);
        }, 35_000);
      });
      await step(page, 'Advance into the reminder window and read both automatically delivered emails', async () => {
        advanceReminderClock(new Date(journeys[0]!.startsAt.getTime() - 23.75 * 3_600_000));
        for (const j of journeys) {
          await expect
            .poll(
              async () => {
                const messages = await reminderMessages(j.mailURL, j.patient, j.bookingId);
                j.message = messages[0];
                return messages.length;
              },
              { timeout: 45_000, message: `${j.name} sends its reminder automatically` },
            )
            .toBe(1);
          const text = j.message!.Text;
          const expectedWhen = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London',
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(j.startsAt);
          expect(j.message!.Subject).toBe(`Reminder: your ${j.appointment} at ${j.name}`);
          expect(text.startsWith(`${j.name}\n`)).toBe(true);
          expect(text).toContain(`When: ${expectedWhen} (UK time, Europe/London)`);
          expect(text).toContain(`Your ${j.practitionerWord}: ${j.practitioner}`);
          expect(text).toContain(`Duration: ${j.minutes} minutes`);
          expect(text).not.toMatch(/phone|7700|\+44/i);
          j.moveURL = /^Reschedule: (\S+)$/m.exec(text)![1]!;
          j.cancelURL = /^Cancel: (\S+)$/m.exec(text)![1]!;
          for (const url of [j.moveURL, j.cancelURL]) expect(new URL(url).origin).toBe(new URL(j.baseURL).origin);
          expect(new URL(j.moveURL).pathname).toBe(`/bookings/${j.bookingId}/reschedule`);
          expect(new URL(j.cancelURL).pathname).toBe(`/bookings/${j.bookingId}/review`);
          await test.info().attach(`${j.name} reminder`, { body: text, contentType: 'text/plain' });
        }
      });
      await step(
        page,
        'Wait through repeated automatic checks and still find exactly one reminder per booking',
        async () => {
          await observeReminderPolls(async () => {
            for (const j of journeys) expect(await reminderMessages(j.mailURL, j.patient, j.bookingId)).toHaveLength(1);
          });
        },
      );
      await step(page, 'Open both email links signed out, then sign in to review current details', async () => {
        for (const j of journeys) {
          // The time advance expired the original session. Check both email destinations.
          for (const url of [j.moveURL, j.cancelURL]) {
            await j.page.goto(url);
            await expect(j.page).toHaveURL(/\/auth\/sign-in\?next=/);
            await expect(j.page.getByTestId('review-current')).toHaveCount(0);
          }
          await j.page.getByTestId('sign-in-email').fill(j.patient);
          await j.page.getByTestId('sign-in-password').fill(demoPassword());
          await j.page.getByTestId('sign-in-submit').click();
          await expect(j.page.getByTestId('review-current')).toContainText(j.when);
          await expect(j.page.getByTestId('review-current')).toContainText(j.practitioner);
          await expect(j.page.getByTestId('review-current')).toContainText(`${j.minutes} minutes`);
          await expect(j.page.getByTestId('review-consequences')).toContainText('Cancelling releases your time');
          await j.page.getByTestId('confirm-change').focus();
          await expect(j.page.getByTestId('confirm-change')).toBeFocused();
        }
      });
      await step(page, 'See that another client and the other clinic cannot open the emailed booking', async () => {
        for (const [i, j] of journeys.entries()) {
          const stranger = await (await browser.newContext({ baseURL: j.baseURL })).newPage();
          try {
            await signIn(stranger, j.otherPatient);
            for (const url of [j.moveURL, j.cancelURL]) {
              await stranger.goto(url);
              await expect(stranger.getByTestId('review-current')).toHaveCount(0);
              await expect(stranger.getByTestId('current-when')).toHaveCount(0);
              await expect(stranger.getByTestId('confirm-change')).toHaveCount(0);
              await expect(stranger.getByTestId('reschedule-to')).toHaveCount(0);
            }
          } finally {
            await stranger.context().close();
          }
          const other = journeys[1 - i]!;
          for (const url of [j.moveURL, j.cancelURL]) {
            await other.page.goto(new URL(new URL(url).pathname, other.baseURL).href);
            await expect(other.page.getByTestId('review-current')).toHaveCount(0);
            await expect(other.page.getByTestId('current-when')).toHaveCount(0);
            await expect(other.page.getByTestId('confirm-change')).toHaveCount(0);
            await expect(other.page.getByTestId('reschedule-to')).toHaveCount(0);
          }
        }
      });
      await step(page, 'Use each emailed Reschedule link to review and confirm a new time', async () => {
        for (const j of journeys) {
          await j.page.goto(j.moveURL);
          await expect(j.page.getByTestId('current-when')).toContainText(j.when);
          const target = j.page.getByTestId('reschedule-to').first();
          j.movedWhen = (await target.textContent())!.trim();
          await target.click();
          await expect(j.page.getByTestId('review-current')).toContainText(j.when);
          await expect(j.page.getByTestId('review-new')).toContainText(j.movedWhen);
          await expect(j.page.getByTestId('review-new')).toContainText(`${j.minutes} minutes`);
          await expect(j.page.getByTestId('review-consequences')).toContainText(
            'Your old time is released only when the new time is secured',
          );
          await j.page.getByTestId('confirm-change').click();
          await expect(j.page).toHaveURL(/\/bookings\?notice=rescheduled$/);
          await expect(bookingRow(j.page, 'upcoming-bookings', j.movedWhen)).toBeVisible();
        }
      });
      await step(page, 'Reopen each original Cancel link and confirm cancellation of the current time', async () => {
        for (const j of journeys) {
          await j.page.goto(j.cancelURL);
          await expect(j.page.getByTestId('review-current')).toContainText(j.movedWhen);
          await expect(j.page.getByTestId('review-current')).not.toContainText(j.when);
          await expect(j.page.getByTestId('review-consequences')).toContainText('No further reminder');
          await expect(j.page.getByTestId('review-consequences')).toContainText(j.cancellationTiming);
          await j.page.getByTestId('confirm-change').click();
          await expect(j.page).toHaveURL(/\/bookings\?notice=cancelled$/);
          await expect(bookingRow(j.page, 'other-bookings', j.movedWhen).getByTestId('booking-status')).toHaveText(
            j.cancelledStatus,
          );
        }
      });
    } finally {
      for (const j of journeys) await j.page.context().close();
    }
  });
}
