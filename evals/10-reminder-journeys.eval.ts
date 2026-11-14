import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PATIENT_2,
  bookSlot,
  bookingRow,
  demoPassword,
  londonDate,
  pickFreeSlot,
  signIn,
  step,
} from './support';

test('Clinic staff can switch reminder emails off and on, and the choice stays saved', async ({ page, browser }) => {
  await step(page, 'Sign in as clinic staff and open settings', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, ADMIN);
    await page.goto('/admin/settings');
    await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    await expect(page.getByTestId('reminders-hint')).toContainText('23 to 24 hours');
  });
  try {
    await step(page, 'Switch reminders off and see the saved choice after reopening settings', async () => {
      await page.getByTestId('admin-reminders-enabled').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await page.goto('/admin/settings');
      await expect(page.getByTestId('admin-reminders-enabled')).not.toBeChecked();
    });
    const client = await (await browser.newContext()).newPage();
    await step(client, 'Sign in as a client and see that reminder settings are reserved for staff', async () => {
      await signIn(client, PATIENT_2);
      await client.goto('/admin/settings');
      await expect(client.getByTestId('admin-reminders-enabled')).toHaveCount(0);
      await expect(client.getByTestId('admin-save-settings')).toHaveCount(0);
    });
    await client.context().close();
  } finally {
    await step(page, 'Switch reminders back on and see the saved choice after reopening settings', async () => {
      await page.goto('/admin/settings');
      await page.getByTestId('admin-reminders-enabled').check();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toBeVisible();
      await page.goto('/admin/settings');
      await expect(page.getByTestId('admin-reminders-enabled')).toBeChecked();
    });
  }
});

test('Reminder links require sign-in, protect booking privacy and show current details and consequences before a client confirms a change.', async ({
  page,
  browser,
}) => {
  const date = londonDate(17);
  const { when, cancelPath, movePath } = await step(
    page,
    'Book a session and keep its private change links',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, PATIENT_1);
      const when = await bookSlot(page, (await pickFreeSlot(page, date)).id);
      const row = bookingRow(page, 'upcoming-bookings', when);
      const cancelPath = (await row.getByTestId('cancel-booking').getAttribute('href'))!;
      const movePath = (await row.getByTestId('reschedule-link').getAttribute('href'))!;
      expect(cancelPath).toMatch(/\/review$/);
      return { when, cancelPath, movePath };
    },
  );
  await step(page, 'Open the cancel link while signed out and sign in to review the session', async () => {
    await page.getByTestId('sign-out').click();
    await page.goto(cancelPath);
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=/);
    await page.getByTestId('sign-in-email').fill(PATIENT_1);
    await page.getByTestId('sign-in-password').fill(demoPassword());
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('review-current')).toContainText(when);
    await expect(page.getByTestId('review-current')).toContainText('45 minutes');
    await page.getByTestId('confirm-change').focus();
    await expect(page.getByTestId('confirm-change')).toBeFocused();
    await expect(page.getByTestId('review-consequences')).toContainText('Cancelling releases your time');
  });
  const stranger = await (await browser.newContext()).newPage();
  await step(
    stranger,
    'Sign in as another client and see neither private change link reveals booking details',
    async () => {
      await signIn(stranger, PATIENT_2);
      for (const path of [cancelPath, movePath]) {
        await stranger.goto(path);
        await expect(stranger.getByTestId('review-current')).toHaveCount(0);
        await expect(stranger.getByTestId('current-when')).toHaveCount(0);
        await expect(stranger.getByTestId('confirm-change')).toHaveCount(0);
        await expect(stranger.getByTestId('reschedule-to')).toHaveCount(0);
      }
    },
  );
  await stranger.context().close();
  const movedWhen = await step(page, 'Use the reschedule link and review the current and proposed times', async () => {
    await page.goto(movePath);
    const target = page.getByTestId('reschedule-to').first();
    const movedWhen = (await target.textContent())!.trim();
    await target.click();
    await expect(page.getByTestId('review-current')).toContainText(when);
    await expect(page.getByTestId('review-new')).toContainText(movedWhen);
    await expect(page.getByTestId('review-new')).toContainText('45 minutes');
    await expect(page.getByTestId('review-consequences')).toContainText(
      'Your old time is released only when the new time is secured',
    );
    return movedWhen;
  });
  await step(page, 'Confirm the move and see the new time in My bookings', async () => {
    await page.getByTestId('confirm-change').click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    await expect(bookingRow(page, 'upcoming-bookings', movedWhen)).toBeVisible();
  });
  await step(
    page,
    'Reopen the original cancel link and see the current time before confirming cancellation',
    async () => {
      await page.goto(cancelPath);
      await expect(page.getByTestId('review-current')).toContainText(movedWhen);
      await expect(page.getByTestId('review-current')).not.toContainText(when);
      await expect(page.getByTestId('review-consequences')).toContainText('No further reminder');
      await page.getByTestId('confirm-change').click();
      await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
      await expect(bookingRow(page, 'other-bookings', movedWhen).getByTestId('booking-status')).toHaveText('Cancelled');
    },
  );
});
