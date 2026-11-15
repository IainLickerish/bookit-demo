import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_2,
  PATIENT_3,
  bookingRow,
  demoPassword,
  evalNow,
  londonDate,
  sessionFor,
  signIn,
  slotOffered,
  step,
} from './support';
import { bookDueSession, setReminders, waitForReminder } from './reminder-support';

async function reminderSetup(browser: Parameters<typeof sessionFor>[0]) {
  const staff = await (await browser.newContext()).newPage();
  const original = await step(staff, 'Sign in as staff and enable reminder emails', async () => {
    await signIn(staff, ADMIN);
    await staff.goto('/admin/settings');
    const original = await staff.getByTestId('admin-reminders').inputValue();
    await setReminders(staff, 'on');
    return original;
  });
  return { staff, original };
}
async function reminderPaths(address: string, bookingId: string) {
  const email = await waitForReminder(address, bookingId);
  const reschedule = /^Reschedule: (https?:\/\/\S+)/m.exec(email.text)?.[1];
  const cancel = /^Cancel: (https?:\/\/\S+)/m.exec(email.text)?.[1];
  expect(reschedule, 'the reminder has a reschedule link').toBeTruthy();
  expect(cancel, 'the reminder has a cancellation link').toBeTruthy();
  const paths = { reschedule: new URL(reschedule!).pathname, cancel: new URL(cancel!).pathname };
  expect(paths.reschedule).toBe(`/bookings/${bookingId}/reschedule`);
  expect(paths.cancel).toBe(`/bookings/${bookingId}/cancel`);
  // Follow only paths in this running demo copy, regardless of its configured public mail origin.
  return paths;
}
async function restore(staff: Page, original: string) {
  await step(staff, 'Restore the clinic’s original reminder choice', async () => {
    await setReminders(staff, original);
  });
}

test('Opening reminder links or selecting a new time leaves bookings unchanged until the client explicitly confirms the reviewed change.', async ({
  browser,
}) => {
  const { staff, original } = await reminderSetup(browser);
  const client = await sessionFor(browser, PATIENT_2);
  let monitor: Page | undefined;
  try {
    const { booking, paths } = await step(client, 'Book a session and receive its two reminder links', async () => {
      const booking = await bookDueSession(client);
      return { booking, paths: await reminderPaths(PATIENT_2, booking.id) };
    });
    await step(client, 'Open the reminder’s reschedule link and see the current booking unchanged', async () => {
      await client.goto(paths.reschedule);
      await expect(client.getByTestId('current-when')).toContainText(booking.when);
      await expect(client.getByTestId('slot-list')).toBeVisible();
      monitor = await client.context().newPage();
      await monitor.goto('/bookings');
      await expect(bookingRow(monitor, 'upcoming-bookings', booking.when).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
    });
    const newWhen = await step(
      client,
      'Choose another time and review both bookings without saving a change',
      async () => {
        const choices = await client
          .getByTestId('reschedule-to')
          .evaluateAll((nodes) =>
            nodes.map((node) => ({ when: node.textContent?.trim(), start: node.getAttribute('data-starts-at') })),
          );
        const target = choices.find((choice) => choice.start && Date.parse(choice.start) > evalNow().getTime());
        expect(target?.when).toBeTruthy();
        await client.getByTestId('reschedule-to').filter({ hasText: target!.when! }).click();
        await expect(client.getByTestId('review-current-when')).toContainText(booking.when);
        await expect(client.getByTestId('review-new-when')).toContainText(target!.when!);
        await expect(client.getByTestId('review-new-duration')).toContainText('45 minutes');
        await expect(client.getByTestId('reschedule-consequences')).toContainText('original time is kept');
        await monitor!.goto('/bookings');
        await expect(bookingRow(monitor!, 'upcoming-bookings', booking.when).getByTestId('booking-status')).toHaveText(
          'Confirmed',
        );
        await expect(bookingRow(monitor!, 'upcoming-bookings', target!.when!)).toHaveCount(0);
        return target!.when!;
      },
    );
    await step(client, 'Confirm the reviewed move and see its saved new time', async () => {
      await client.getByTestId('confirm-reschedule').click();
      await expect(client).toHaveURL(/\/bookings\?notice=rescheduled$/);
      await expect(bookingRow(client, 'upcoming-bookings', newWhen).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
    });
    await step(client, 'Open the original reminder’s cancel link and keep the current booking', async () => {
      await client.goto(paths.cancel);
      await expect(client.getByTestId('review-current-when')).toContainText(newWhen);
      await client.getByRole('link', { name: 'Keep my booking', exact: true }).click();
      await expect(bookingRow(client, 'upcoming-bookings', newWhen).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
    });
  } finally {
    try {
      await restore(staff, original);
    } finally {
      await monitor?.close();
      await client.context().close();
      await staff.context().close();
    }
  }
});

test('Confirming cancellation saves Cancelled, records lateness correctly and releases the time before displaying success.', async ({
  browser,
}) => {
  const { staff, original } = await reminderSetup(browser);
  const client = await sessionFor(browser, PATIENT_2);
  let other: Page | undefined;
  try {
    const { booking, paths } = await step(
      client,
      'Book a session within the late window and receive its reminder',
      async () => {
        const booking = await bookDueSession(client);
        return { booking, paths: await reminderPaths(PATIENT_2, booking.id) };
      },
    );
    await step(
      client,
      'Open the reminder while signed out and return to cancellation review after signing in',
      async () => {
        await client.getByTestId('sign-out').click();
        await expect(client).toHaveURL(/\/auth\/sign-in$/);
        await client.goto(paths.cancel);
        await expect(client).toHaveURL(/\/auth\/sign-in\?returnTo=/);
        await client.getByTestId('sign-in-email').fill(PATIENT_2);
        await client.getByTestId('sign-in-password').fill(demoPassword());
        await client.getByTestId('sign-in-submit').click();
        await expect(client).toHaveURL(paths.cancel);
        await expect(client.getByTestId('review-current-when')).toContainText(booking.when);
        await expect(client.getByTestId('review-current-duration')).toContainText('45 minutes');
        await expect(client.getByTestId('cancel-window')).toContainText('This is a late cancellation.');
        await client.getByRole('link', { name: 'Keep my booking', exact: true }).click();
        await expect(bookingRow(client, 'upcoming-bookings', booking.when).getByTestId('booking-status')).toHaveText(
          'Confirmed',
        );
      },
    );
    await step(client, 'Confirm cancellation and see the saved late-cancellation result', async () => {
      await client.goto(paths.cancel);
      await expect(client.getByTestId('review-current-when')).toContainText(booking.when);
      await client.getByTestId('confirm-cancellation').click();
      await expect(client).toHaveURL(/\/bookings\?notice=cancelled_late$/);
      await expect(client.getByTestId('notice')).toContainText('Booking cancelled as a late cancellation.');
      await client.reload();
      await expect(bookingRow(client, 'other-bookings', booking.when).getByTestId('booking-status')).toContainText(
        'Cancelled (late)',
      );
    });
    other = await sessionFor(browser, PATIENT_3);
    await step(other, 'See that the cancelled session time is available to another client', async () => {
      expect(await slotOffered(other!, londonDate(0, new Date(booking.startsAt)), booking.slotId)).toBe(true);
    });
  } finally {
    try {
      await restore(staff, original);
    } finally {
      await other?.context().close();
      await client.context().close();
      await staff.context().close();
    }
  }
});

test('Clients cannot view or change another client’s booking through reminder links or forged confirmation submissions.', async ({
  browser,
}) => {
  const { staff, original } = await reminderSetup(browser);
  const owner = await sessionFor(browser, PATIENT_2);
  let stranger: Page | undefined;
  let visitor: Page | undefined;
  try {
    const { victim, control, paths } = await step(
      owner,
      'Book two sessions and receive the reminder for the protected booking',
      async () => {
        const victim = await bookDueSession(owner);
        const control = await bookDueSession(owner);
        return { victim, control, paths: await reminderPaths(PATIENT_2, victim.id) };
      },
    );
    const submission = await step(
      owner,
      'Confirm cancellation of your other booking to obtain a real confirmation submission',
      async () => {
        await owner.goto(`/bookings/${control.id}/cancel`);
        await expect(owner.getByTestId('review-current-when')).toContainText(control.when);
        const submitted = owner.waitForRequest(
          (request) => request.method() === 'POST' && Boolean(request.headers()['next-action']),
        );
        await owner.getByTestId('confirm-cancellation').click();
        const request = await submitted;
        await expect(owner).toHaveURL(/\/bookings\?notice=cancelled_late$/);
        const body = request.postDataBuffer();
        const contentType = request.headers()['content-type'];
        const action = request.headers()['next-action'];
        if (!body || !contentType || !action)
          throw new Error('The real confirmation submission must have a body and action headers.');
        // Change only the booking and reviewed slot references. A missing ownership
        // check would accept this otherwise valid confirmation for the victim.
        const forged = body.toString().replaceAll(control.id, victim.id).replaceAll(control.slotId, victim.slotId);
        expect(forged).toContain(victim.id);
        expect(forged).toContain(victim.slotId);
        return {
          data: Buffer.from(forged),
          headers: {
            'content-type': contentType,
            'next-action': action,
            accept: 'text/x-component',
            origin: new URL(request.url()).origin,
          },
          maxRedirects: 0,
        };
      },
    );
    stranger = await sessionFor(browser, PATIENT_3);
    await step(
      stranger,
      'Try opening the other client’s reminder links and posting their confirmation while signed in or signed out',
      async () => {
        for (const path of [paths.cancel, paths.reschedule]) {
          await stranger!.goto(path);
          await expect(stranger!.getByTestId('booking-error')).toContainText('We could not find that booking.');
          await expect(stranger!.getByTestId('review-current-when')).toHaveCount(0);
          await expect(stranger!.getByTestId('confirm-cancellation')).toHaveCount(0);
        }
        const response = await stranger!.request.post(paths.cancel, submission);
        expect(response.headers()['x-action-redirect']).toContain('error=booking_not_found');
        visitor = await (await browser.newContext()).newPage();
        await visitor.goto(paths.cancel);
        await expect(visitor).toHaveURL(/\/auth\/sign-in\?returnTo=/);
        const unauthenticated = await visitor.request.post(paths.cancel, submission);
        expect(unauthenticated.headers()['x-action-redirect']).toContain('/auth/sign-in');
      },
    );
    await step(owner, 'Reopen My bookings and see that the protected booking is still confirmed', async () => {
      await owner.goto('/bookings');
      await expect(bookingRow(owner, 'upcoming-bookings', victim.when).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
    });
  } finally {
    try {
      await restore(staff, original);
    } finally {
      await visitor?.context().close();
      await stranger?.context().close();
      await owner.context().close();
      await staff.context().close();
    }
  }
});
