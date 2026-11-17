import { expect, test } from '@playwright/test';
import { query, signIn } from './support';

// Sign-in credentials must not be retained in browser traces.
test.use({ trace: 'off' });

test('a failed late-cancellation save shows a problem and keeps the booking confirmed', async ({ page }) => {
  await signIn(page, 'patient1@patients.example.test');
  await page.goto('/slots?date=2026-10-20');
  const slot = page.getByTestId('slot-link').first();
  const slotId = await slot.getAttribute('data-slot-id');
  await slot.click();
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  const [booking] = await query<{ id: string }>('select id from booking where slot_id = $1 and status = $2', [
    slotId,
    'confirmed',
  ]);
  expect(booking).toBeDefined();

  // Refuse the write at commit, after the application has tried to save it.
  // This trigger exists only in the disposable browser-test database.
  await query(`create function refuse_test_cancellation() returns trigger language plpgsql as $$
    begin
      if new.status = 'cancelled' then raise exception 'Test cancellation save refused'; end if;
      return new;
    end;
  $$`);
  try {
    await query(`create constraint trigger refuse_test_cancellation
      after update on booking deferrable initially deferred
      for each row execute function refuse_test_cancellation()`);
    try {
      await page.locator(`[data-booking-id="${booking!.id}"]`).getByTestId('cancel-booking').click();
      await expect(page.getByTestId('error-page')).toContainText('Something went wrong');
      await expect(page.getByTestId('error-page')).toContainText('Please try again.');
      await expect(page.getByTestId('notice')).toHaveCount(0);
      expect(
        await query('select status, late_cancellation, cancelled_at from booking where id = $1', [booking!.id]),
      ).toEqual([{ status: 'confirmed', late_cancellation: false, cancelled_at: null }]);
      await page.goto('/bookings');
      await expect(page.locator(`[data-booking-id="${booking!.id}"]`).getByTestId('booking-status')).toHaveText(
        'Confirmed',
      );
      await page.goto('/slots?date=2026-10-20');
      await expect(page.locator(`[data-slot-id="${slotId}"]`)).toHaveCount(0);
    } finally {
      await query('drop trigger refuse_test_cancellation on booking');
    }
  } finally {
    await query('drop function refuse_test_cancellation()');
  }
});
