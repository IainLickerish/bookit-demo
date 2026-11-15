import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, PATIENT_3, PRACTITIONER, bookingRow, evalNow, sessionFor, step } from './support';
import { bookDueSession, remindersFor, setReminders, waitForReminder } from './reminder-support';

test('With reminders enabled, each upcoming confirmed booking receives a reminder at the first unattended check within 24 hours of its current start.', async ({
  browser,
}) => {
  const staff = await sessionFor(browser, ADMIN);
  let original: string | undefined;
  const contexts = [staff.context()];
  try {
    await step(staff, 'Switch reminders off while arranging a new session', async () => {
      await staff.goto('/admin/settings');
      original = await staff.getByTestId('admin-reminders').inputValue();
      await setReminders(staff, 'off');
    });
    const client = await sessionFor(browser, PATIENT_2);
    contexts.push(client.context());
    const booking = await step(client, 'Book a free session within the next 24 hours', async () =>
      bookDueSession(client),
    );
    await step(staff, 'Switch reminder emails on for the clinic', async () => {
      await setReminders(staff, 'on');
    });
    await step(client, 'Receive a reminder with the saved session details in UK time', async () => {
      const email = await waitForReminder(PATIENT_2, booking.id);
      expect(email.subject).toBe(`Reminder: your session on ${booking.when}`);
      expect(email.text).toContain(`When: ${booking.when} (UK time)`);
      expect(email.text).toContain(`Physiotherapist: ${PRACTITIONER}`);
      const clinic = await client.getByTestId('clinic-name').textContent();
      expect(email.text.split(/\r?\n/, 1)[0]?.trim(), 'the first line names the clinic').toBe(clinic?.trim());
      expect(email.text).toContain('To reschedule or cancel, sign in and open My bookings:');
      expect(email.text).toContain('/bookings');
    });
    await step(client, 'Receive a later reminder without repeating the first one', async () => {
      const later = await bookDueSession(client);
      await waitForReminder(PATIENT_2, later.id);
      expect(await remindersFor(PATIENT_2, booking.id)).toHaveLength(1);
    });
  } finally {
    try {
      if (original !== undefined)
        await step(staff, 'Restore the clinic’s original reminder choice', async () => {
          await setReminders(staff, original!);
        });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
});

test('Moved bookings receive reminders for their new time when no reminder has already been attempted.', async ({
  browser,
}) => {
  const staff = await sessionFor(browser, ADMIN);
  let original: string | undefined;
  const contexts = [staff.context()];
  try {
    await step(staff, 'Switch reminders off while arranging and moving a session', async () => {
      await staff.goto('/admin/settings');
      original = await staff.getByTestId('admin-reminders').inputValue();
      await setReminders(staff, 'off');
    });
    const client = await sessionFor(browser, PATIENT_3);
    contexts.push(client.context());
    const booking = await step(client, 'Book a free session within the next 24 hours', async () =>
      bookDueSession(client),
    );
    const movedWhen = await step(
      client,
      'Move the session to another free time before reminders are enabled',
      async () => {
        await bookingRow(client, 'upcoming-bookings', booking.when).getByTestId('reschedule-link').click();
        const now = evalNow().getTime();
        const choices = await client.getByTestId('reschedule-to').evaluateAll((nodes) =>
          nodes.map((node) => ({
            start: node.getAttribute('data-starts-at'),
            when: node.textContent?.trim(),
          })),
        );
        const target = choices.find(
          (choice) => choice.start && Date.parse(choice.start) > now && Date.parse(choice.start) <= now + 86_400_000,
        );
        expect(target?.when, 'a different free session is within the next 24 hours').toBeTruthy();
        await client.getByTestId('reschedule-to').filter({ hasText: target!.when! }).click();
        await expect(client).toHaveURL(/\/bookings\?notice=rescheduled$/);
        await expect(bookingRow(client, 'upcoming-bookings', target!.when!)).toBeVisible();
        return target!.when!;
      },
    );
    await step(staff, 'Switch reminder emails on after the move has been saved', async () => {
      await setReminders(staff, 'on');
    });
    await step(client, 'Receive the reminder for the new session time', async () => {
      const email = await waitForReminder(PATIENT_3, booking.id);
      expect(email.text).toContain(`When: ${movedWhen} (UK time)`);
      expect(email.subject).toBe(`Reminder: your session on ${movedWhen}`);
      expect(email.text).not.toContain(`When: ${booking.when}`);
      expect(email.text).toContain(`Physiotherapist: ${PRACTITIONER}`);
    });
  } finally {
    try {
      if (original !== undefined)
        await step(staff, 'Restore the clinic’s original reminder choice', async () => {
          await setReminders(staff, original!);
        });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
});
