import { expect, test } from '@playwright/test';
import {
  E2E_MAIL_FROM,
  E2E_START,
  loadState,
  query,
  receivedMail,
  serverLogLines,
  showDay,
  signIn,
  writeClock,
} from './support';

const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

test.describe.configure({ mode: 'serial' });

test.describe('BookIt core booking journeys (REQ-18.1-01)', () => {
  let bookedSlotId = '';

  test('booking routes require sign-in (security)', async ({ page }) => {
    for (const route of ['/', '/slots', '/bookings', `/book/${UNKNOWN_ID}`, `/bookings/${UNKNOWN_ID}/reschedule`]) {
      await page.goto(route);
      await expect(page, `GET ${route} without a session`).toHaveURL(/\/auth\/sign-in$/);
    }
  });

  test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await page.getByTestId('sign-in-email').fill(loadState().patient1);
    await page.getByTestId('sign-in-password').fill('not-the-password-123');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toHaveText('The email address or password is not correct.');
    await expect(page).toHaveURL(/\/auth\/sign-in\?error=invalid$/);
  });

  test('a patient books a slot and sees it in My bookings', async ({ page }) => {
    await signIn(page, loadState().patient1);
    await page.getByTestId('nav-book').click();
    await showDay(page, 'Pat Physio', '2026-10-22');
    await expect(page.getByTestId('shown-date')).toHaveText('Thursday, 22 October 2026');
    const slot = page.getByTestId('slot-link').filter({ hasText: '10:30' });
    bookedSlotId = (await slot.getAttribute('data-slot-id')) ?? '';
    await slot.click();
    await expect(page.getByTestId('book-when')).toHaveText('Thu, 22 Oct 2026, 10:30 (45 minutes)');
    await expect(page.getByTestId('book-phone')).toHaveValue('+44 7700 900001');
    await page.getByTestId('confirm-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
    await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
    const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('booking-when')).toHaveText('Thu, 22 Oct 2026, 10:30');
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');

    const [stored] = await query<{ status: string; phone: string; created_at: Date; starts_at: Date }>(
      `select b.status, b.phone, b.created_at, s.starts_at from booking b join slot s on s.id = b.slot_id where b.slot_id = $1`,
      [bookedSlotId],
    );
    expect(stored?.status).toBe('confirmed');
    expect(stored?.phone).toBe('+44 7700 900001');
    expect(stored?.starts_at.toISOString()).toBe('2026-10-22T09:30:00.000Z');
    // Written at virtual time, not at the real time of the test run.
    expect(stored?.created_at.toISOString()).toBe(E2E_START);

    // One confirmation email to the patient, with the contact phone because
    // the test clinic includes contact details (M0-24c, plan 12.1).
    const mail = receivedMail();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ from: E2E_MAIL_FROM, to: [loadState().patient1] });
    expect(mail[0]!.raw).toContain('Contact phone: +44 7700 900001');
    expect(mail[0]!.raw).toContain('With: Pat Physio');
  });

  test('another patient is not offered the booked slot and cannot open the first patient’s booking', async ({
    page,
  }) => {
    const [booking] = await query<{ id: string }>(`select id from booking where slot_id = $1`, [bookedSlotId]);
    await signIn(page, loadState().patient2);
    await page.getByTestId('nav-book').click();
    await showDay(page, 'Pat Physio', '2026-10-22');
    await expect(page.getByTestId('slot-link').filter({ hasText: '09:45' })).toHaveCount(1);
    await expect(page.getByTestId('slot-link').filter({ hasText: '10:30' })).toHaveCount(0);
    await page.goto(`/book/${bookedSlotId}`);
    await expect(page.getByTestId('slot-taken')).toBeVisible();
    await expect(page.getByTestId('confirm-booking')).toHaveCount(0);
    await page.goto(`/bookings/${booking?.id}/reschedule`);
    await expect(page.getByTestId('not-found')).toBeVisible();
  });

  test('a patient reschedules a booking to another free slot', async ({ page }) => {
    await signIn(page, loadState().patient1);
    await page.getByTestId('reschedule-link').click();
    await expect(page.getByTestId('current-when')).toHaveText('Thu, 22 Oct 2026, 10:30');
    await expect(page.getByTestId('reschedules-remaining')).toHaveText('You can reschedule this booking 3 more times.');
    await expect(page.getByTestId('date-input')).toHaveValue('2026-10-22');
    await page.getByTestId('reschedule-to').filter({ hasText: '14:15' }).click();
    await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
    await expect(page.getByTestId('notice')).toHaveText('Booking rescheduled.');
    const row = page.getByTestId('upcoming-bookings').getByTestId('booking-row');
    await expect(row.getByTestId('booking-when')).toHaveText('Thu, 22 Oct 2026, 14:15');
    const [stored] = await query<{ reschedule_count: number; slot_id: string }>(
      `select reschedule_count, slot_id from booking where patient_id = (select id from "user" where email = $1)`,
      [loadState().patient1],
    );
    expect(stored?.reschedule_count).toBe(1);
    expect(stored?.slot_id).not.toBe(bookedSlotId);
    await page.getByTestId('nav-book').click();
    await showDay(page, 'Pat Physio', '2026-10-22');
    await expect(page.getByTestId('slot-link').filter({ hasText: '10:30' })).toHaveCount(1);
  });

  test('a patient cancels a booking outside the late-cancellation window', async ({ page }) => {
    await signIn(page, loadState().patient1);
    await page.getByTestId('cancel-booking').click();
    await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
    await expect(page.getByTestId('notice')).toHaveText('Booking cancelled.');
    await expect(page.getByTestId('no-upcoming')).toBeVisible();
    const row = page.getByTestId('other-bookings').getByTestId('booking-row');
    await expect(row.getByTestId('booking-status')).toHaveText('Cancelled');
  });

  test('a patient without a phone can book with contact collection off and cancel outside the late window', async ({
    page,
  }) => {
    await query('update clinic_settings set include_contact_in_confirmation=false where id=1');
    try {
      await signIn(page, loadState().patient2);
      await page.getByTestId('nav-book').click();
      await showDay(page, 'Pat Physio', '2026-10-22');
      await page.getByTestId('slot-link').filter({ hasText: '11:15' }).click();
      await expect(page.getByTestId('book-phone')).toHaveValue('');
      await page.getByTestId('confirm-booking').click();
      await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
      await page.getByTestId('cancel-booking').click();
      await expect(page).toHaveURL(/\/bookings\?notice=cancelled$/);
      await expect(page.getByTestId('notice')).toHaveText('Booking cancelled.');
      const row = page.getByTestId('other-bookings').getByTestId('booking-row');
      await expect(row.getByTestId('booking-status')).toHaveText('Cancelled');
      const [stored] = await query<{ status: string; late_cancellation: boolean; phone: string | null }>(
        `select b.status, b.late_cancellation, b.phone from booking b join slot s on s.id = b.slot_id where s.starts_at = '2026-10-22T10:15:00Z'`,
      );
      expect(stored).toEqual({ status: 'cancelled', late_cancellation: false, phone: null });
    } finally {
      await query('update clinic_settings set include_contact_in_confirmation=true where id=1');
    }
  });

  test('booking times follow the shared virtual clock when it advances', async ({ page }) => {
    await signIn(page, loadState().patient1);
    await page.getByTestId('nav-book').click();
    await showDay(page, 'Pat Physio', '2026-10-22');
    await page.getByTestId('slot-link').filter({ hasText: '09:00' }).click();
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');

    writeClock(loadState().clockFile, '2026-10-20T09:00:00.000Z');

    await page.getByTestId('nav-book').click();
    await showDay(page, 'Pat Physio', '2026-10-20');
    // 10:00 local now: slots that have started are no longer offered.
    await expect(page.getByTestId('slot-link').filter({ hasText: '09:45' })).toHaveCount(0);
    await expect(page.getByTestId('slot-link').first()).toHaveText('Tue, 20 Oct 2026, 10:30');

    await page.getByTestId('nav-my-bookings').click();
    await page.getByTestId('cancel-booking').click();
    await expect(page.getByTestId('notice')).toHaveText('Booking cancelled.');
    const [stored] = await query<{ cancelled_at: Date; late_cancellation: boolean }>(
      `select b.cancelled_at, b.late_cancellation from booking b join slot s on s.id = b.slot_id where s.starts_at = '2026-10-22T08:00:00Z'`,
    );
    expect(stored?.cancelled_at.toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(stored?.late_cancellation).toBe(false);
  });

  test('request logs carry counter-based request IDs, the tenant, the route and virtual times', async () => {
    const lines = serverLogLines();
    const requests = lines.filter((line) => line.event === 'http.request');
    expect(requests.length).toBeGreaterThan(20);
    const ids = requests.map((line) => String(line.request_id));
    expect(ids.every((id) => /^req-\d{6}$/.test(id))).toBe(true);
    expect(ids).toEqual(ids.map((_, i) => `req-${String(i + 1).padStart(6, '0')}`));
    expect(new Set(requests.map((line) => line.tenant))).toEqual(new Set(['test']));
    const routes = new Set(requests.map((line) => line.route));
    for (const route of ['/auth/sign-in', '/bookings', '/slots']) {
      expect(routes).toContain(route);
    }

    const bookingEvents = lines.filter((line) => String(line.event).startsWith('booking.'));
    expect(bookingEvents.map((line) => line.event)).toEqual(
      expect.arrayContaining(['booking.confirmed', 'booking.rescheduled', 'booking.cancelled']),
    );
    for (const line of bookingEvents) {
      expect(String(line.request_id)).toMatch(/^req-\d{6}$/);
      expect(typeof line.route).toBe('string');
      expect(line.tenant).toBe('test');
    }
    for (const line of lines) {
      expect(['2026-10-20T07:00:00.000Z', '2026-10-20T09:00:00.000Z']).toContain(line.time);
    }

    const text = JSON.stringify(lines);
    expect(text).not.toContain('patients.example.test');
    expect(text).not.toContain('7700 900001');
    expect(text).not.toContain(loadState().password);
  });
});
