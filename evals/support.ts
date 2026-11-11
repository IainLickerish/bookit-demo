import { expect, test, type Browser, type Page } from '@playwright/test';

export async function step<T>(page: Page, name: string, body: () => Promise<T>): Promise<T> {
  return test.step(name, async () => {
    const result = await body();
    const path = test.info().outputPath(`step-${test.info().attachments.length + 1}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 70 });
    await test.info().attach(`step: ${name}`, { path, contentType: 'image/jpeg' });
    return result;
  });
}

/** The seeded Acme Physio accounts in a demo copy. They share the demo password. */
export const PATIENT_1 = 'patient1@patients.acmephysio.test';
export const PATIENT_2 = 'patient2@patients.acmephysio.test';
export const PATIENT_3 = 'patient3@patients.acmephysio.test';
export const ADMIN = 'admin@acmephysio.test';
export const PRACTITIONER = 'Alex Physiotherapist';

const password = (): string => {
  const value = process.env.EVAL_PASSWORD;
  if (!value) throw new Error('Set EVAL_PASSWORD to the demo password');
  return value;
};

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(password());
  await page.getByTestId('sign-in-submit').click();
  await expect(page).not.toHaveURL(/\/auth\/sign-in/);
}

/** A new browser session signed in as this person. */
export async function sessionFor(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await step(page, email === ADMIN ? 'Sign in as clinic staff' : 'Sign in as a client', async () => {
    await signIn(page, email);
  });
  return page;
}

/**
 * The demo copy's "now". The factory runs evals on copies with a fixed date and fixed test data
 * (EVAL_NOW), so every run sees the same days, times and screens; without it, the real clock.
 */
export function evalNow(): Date {
  // eslint-disable-next-line no-restricted-syntax -- evals drive a demo copy, not BookIt's own clock
  return process.env.EVAL_NOW ? new Date(process.env.EVAL_NOW) : new Date();
}

/** A London calendar date, days from the demo copy's "now", as YYYY-MM-DD. */
export function londonDate(daysAhead: number, from = evalNow()): string {
  const day = new Date(from.getTime() + daysAhead * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(day);
}

const isSummer = (iso: string): boolean =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(
    new Date(`${iso}T12:00:00Z`),
  ) === '13';

/** The first date, at least `minDaysAhead` days ahead, that is a whole day of UK winter or summer time. */
export function dateInPeriod(summer: boolean, minDaysAhead: number): string {
  for (let d = minDaysAhead; d < minDaysAhead + 220; d++) {
    if (isSummer(londonDate(d)) === summer && isSummer(londonDate(d - 1)) === summer) return londonDate(d);
  }
  throw new Error('No date found in that clock period');
}

export async function showDay(page: Page, date: string): Promise<void> {
  await page.getByTestId('nav-book').click();
  await page.getByTestId('practitioner-select').selectOption({ label: PRACTITIONER });
  await page.getByTestId('date-input').fill(date);
  await page.getByTestId('show-slots').click();
  await expect(page.getByTestId('date-input')).toHaveValue(date);
}

/** Opens the first free slot on the date and returns its id and time (HH:MM). */
export async function pickFreeSlot(page: Page, date: string): Promise<{ id: string; time: string }> {
  await showDay(page, date);
  const slot = page.getByTestId('slot-link').first();
  await expect(slot).toBeVisible();
  const id = (await slot.getAttribute('data-slot-id')) ?? '';
  const time = ((await slot.textContent()) ?? '').match(/\d\d:\d\d/)?.[0] ?? '';
  expect(id, 'a free slot has an id').not.toBe('');
  return { id, time };
}

/** Gives a contact phone if the booking form has none, as a client would. */
export async function givePhone(page: Page): Promise<void> {
  const phone = page.getByTestId('book-phone');
  if ((await phone.count()) && !(await phone.inputValue())) await phone.fill('+44 7700 900123');
}

/** Books the slot and returns how its time is shown, for example "Mon, 23 Nov 2026, 09:00". */
export async function bookSlot(page: Page, slotId: string): Promise<string> {
  await page.goto(`/book/${slotId}`);
  const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  await givePhone(page);
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  return when;
}

/** The row in My bookings for the booking shown at this time. */
export function bookingRow(page: Page, list: 'upcoming-bookings' | 'other-bookings', when: string) {
  return page
    .getByTestId(list)
    .getByTestId('booking-row')
    .filter({ has: page.getByTestId('booking-when').getByText(when, { exact: true }) })
    .first();
}

export async function slotOffered(page: Page, date: string, slotId: string): Promise<boolean> {
  await showDay(page, date);
  return (await page.locator(`[data-testid="slot-link"][data-slot-id="${slotId}"]`).count()) === 1;
}

/** Messages Mailpit received for this address. */
export async function mailTo(address: string): Promise<{ Subject: string; ID: string }[]> {
  const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  expect(res.ok, 'the demo mail inbox answers').toBe(true);
  return ((await res.json()) as { messages: { Subject: string; ID: string }[] }).messages;
}
