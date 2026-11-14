import { expect, type Page } from '@playwright/test';
import { bookSlot, bookingRow, evalNow, londonDate } from './support';

/** Only use copies explicitly supplied by the runner. A second clinic is optional. */
export function reminderClinics(baseURL: string) {
  const clinics = [
    {
      name: 'Acme Physio',
      baseURL,
      mailURL: process.env.EVAL_MAIL_URL ?? 'http://localhost:8025',
      domain: 'acmephysio.test',
      practitioner: 'Alex Physiotherapist',
      practitionerWord: 'physiotherapist',
      appointment: 'session',
      minutes: 45,
    },
  ];
  if (process.env.EVAL_BEACON_BASE_URL) {
    if (!process.env.EVAL_BEACON_MAIL_URL) throw new Error('Supply EVAL_BEACON_MAIL_URL with EVAL_BEACON_BASE_URL');
    clinics.push({
      name: 'Beacon Dental',
      baseURL: process.env.EVAL_BEACON_BASE_URL,
      mailURL: process.env.EVAL_BEACON_MAIL_URL,
      domain: 'beacondental.test',
      practitioner: 'Blair Dentist',
      practitionerWord: 'clinician',
      appointment: 'appointment',
      minutes: 30,
    });
  }
  return clinics;
}
export type ReminderClinic = ReturnType<typeof reminderClinics>[number];

/** Book a free reference time in the reminder window using the normal client journey. */
export async function bookReminderTime(page: Page, clinic: ReminderClinic) {
  const now = evalNow().getTime();
  // The fresh seed supplies a reference if ordinary opening hours have no free
  // time in this window. Nothing advances the app's clock or invokes delivery.
  const dates = [23, 24].map((hours) => londonDate(0, new Date(now + hours * 3_600_000)));
  for (const date of new Set(dates)) {
    await page.getByTestId('nav-book').click();
    await page.getByTestId('practitioner-select').selectOption({ label: clinic.practitioner });
    await page.getByTestId('date-input').fill(date);
    await page.getByTestId('show-slots').click();
    for (const slot of await page.getByTestId('slot-link').all()) {
      const startsAt = new Date((await slot.getAttribute('data-starts-at'))!);
      const hours = (startsAt.getTime() - now) / 3_600_000;
      if (hours < 23 || hours > 24) continue;
      const when = await bookSlot(page, (await slot.getAttribute('data-slot-id'))!);
      const row = bookingRow(page, 'upcoming-bookings', when);
      await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
      const bookingId = (await row.getAttribute('data-booking-id'))!;
      expect(bookingId).not.toBe('');
      return { when, startsAt, bookingId };
    }
  }
  throw new Error('The fresh demo copy needs a free reference time 23 to 24 hours after EVAL_NOW');
}

export interface ReminderMessage {
  ID: string;
  Subject: string;
  Text: string;
}
export async function reminderMessages(
  mailUrl: string,
  address: string,
  bookingId: string,
): Promise<ReminderMessage[]> {
  const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  expect(response.ok, 'the local reminder inbox answers').toBe(true);
  const { messages } = (await response.json()) as { messages: { ID: string; Subject: string }[] };
  const reminders: ReminderMessage[] = [];
  for (const message of messages.filter((message) => message.Subject.startsWith('Reminder:'))) {
    const detail = await fetch(`${mailUrl}/api/v1/message/${message.ID}`);
    expect(detail.ok, 'the local reminder email opens').toBe(true);
    const { Text } = (await detail.json()) as { Text: string };
    if (Text.includes(`/bookings/${bookingId}/`)) reminders.push({ ...message, Text: Text.replace(/\r\n/g, '\n') });
  }
  return reminders;
}
export async function receiveReminder(clinic: ReminderClinic, bookingId: string) {
  let messages: ReminderMessage[] = [];
  await expect
    .poll(
      async () => {
        messages = await reminderMessages(clinic.mailURL, `patient3@patients.${clinic.domain}`, bookingId);
        return messages.length;
      },
      { timeout: 45_000, message: `${clinic.name} sends one reminder automatically` },
    )
    .toBe(1);
  return messages[0]!;
}

/** Keep checking through more than one real worker poll without changing virtual time. */
export async function observeReminderPolls(check: () => Promise<void>): Promise<void> {
  const end = performance.now() + 65_000;
  do {
    await check();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  } while (performance.now() < end);
  await check();
}
