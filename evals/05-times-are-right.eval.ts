import { expect, test } from '@playwright/test';
import { PATIENT_1, dateInPeriod, showDay, signIn, step } from './support';

// Acme Physio's working day starts at 09:00 UK time all year round.
test('Appointment times are shown in UK time, and stay right when the clocks change', async ({ page }) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_1);
  });
  for (const summer of [false, true]) {
    await step(page, `See session times in UK ${summer ? 'summer' : 'winter'} time`, async () => {
      const date = dateInPeriod(summer, 3);
      await showDay(page, date);
      const first = page.getByTestId('slot-link').first();
      await expect(first, `slots are offered on ${date}`).toBeVisible();
      const startsAt = new Date((await first.getAttribute('data-starts-at')) ?? '');
      const shownTime = ((await first.textContent()) ?? '').match(/\d\d:\d\d/)?.[0];
      const ukTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
      }).format(startsAt);
      expect(shownTime, `the time shown on ${date} is UK time`).toBe(ukTime);
      expect(ukTime, `the first appointment on ${date} is at the start of the UK working day`).toBe('09:00');
    });
  }
});
