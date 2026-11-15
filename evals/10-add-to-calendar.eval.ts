import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  PATIENT_1,
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  londonDate,
  mailTo,
  pickFreeSlot,
  signIn,
  step,
} from './support';

const unfold = (content: string) => content.replace(/\r\n[ \t]/g, '');
const utcValue = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');

async function downloadCalendar(page: Page, link: Locator): Promise<string> {
  const waiting = page.waitForEvent('download');
  await link.click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return unfold(Buffer.concat(chunks).toString('utf8'));
}

function checkAppointment(content: string, startsAt: string) {
  expect(content).toContain('BEGIN:VCALENDAR');
  expect(content).toContain('BEGIN:VEVENT');
  expect(content).toContain(`SUMMARY:Acme Physio with ${PRACTITIONER}`);
  expect(content).toContain('LOCATION:Acme Physio');
  expect(content).toContain(`DTSTART:${utcValue(startsAt)}`);
  expect(content).toContain(`DTEND:${utcValue(new Date(new Date(startsAt).getTime() + 45 * 60_000).toISOString())}`);
  expect(content).toContain('Duration: 45 minutes');
}

async function bookForCalendar(page: Page, daysAhead: number) {
  const slot = await pickFreeSlot(page, londonDate(daysAhead));
  const offered = page.getByTestId('slot-link').filter({ hasText: slot.time });
  const startsAt = (await offered.getAttribute('data-starts-at'))!;
  const when = await bookSlot(page, slot.id);
  const row = bookingRow(page, 'upcoming-bookings', when);
  const reference = (await row.getAttribute('data-booking-id'))!;
  const path = (await row.getByTestId('add-to-calendar').getAttribute('href'))!;
  return { when, startsAt, reference, path };
}

async function moveForCalendar(page: Page, when: string, daysAhead: number) {
  // Choose an offered time on a separate day, without depending on other checks' bookings.
  const slot = await pickFreeSlot(page, londonDate(daysAhead));
  const startsAt = (await page.getByTestId('slot-link').filter({ hasText: slot.time }).getAttribute('data-starts-at'))!;
  await page.getByTestId('nav-my-bookings').click();
  await bookingRow(page, 'upcoming-bookings', when).getByTestId('reschedule-link').click();
  await page.getByTestId('date-input').fill(londonDate(daysAhead));
  await page.getByTestId('show-slots').click();
  const target = page.getByRole('button', { name: new RegExp(`${slot.time}$`) });
  const movedWhen = (await target.textContent())!.trim();
  await target.click();
  await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
  await expect(bookingRow(page, 'upcoming-bookings', movedWhen).getByTestId('booking-status')).toHaveText('Confirmed');
  return { when: movedWhen, startsAt };
}

async function attachmentFor(address: string, reference: string, subject: string): Promise<string> {
  const base = process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';
  let found: { id: string; part: string } | undefined;
  await expect
    .poll(
      async () => {
        const candidates = (await mailTo(address)).filter((message) => message.Subject === subject);
        for (const message of candidates) {
          const response = await fetch(`${base}/api/v1/message/${encodeURIComponent(message.ID)}`);
          expect(response.ok).toBe(true);
          const email = (await response.json()) as {
            Text: string;
            Attachments: { FileName: string; PartID: string; ContentType: string }[];
          };
          if (!email.Text.includes(`Booking reference: ${reference}`)) continue;
          const attachment = email.Attachments.find((part) => part.FileName.endsWith('.ics'));
          expect(attachment, 'the confirmation has a calendar attachment').toBeDefined();
          expect(attachment!.ContentType).toContain('text/calendar');
          found = { id: message.ID, part: attachment!.PartID };
          return true;
        }
        return false;
      },
      { timeout: 20_000, message: 'the confirmation for this saved booking arrives' },
    )
    .toBe(true);
  const response = await fetch(
    `${base}/api/v1/message/${encodeURIComponent(found!.id)}/part/${encodeURIComponent(found!.part)}`,
  );
  expect(response.ok, 'the attached calendar file opens').toBe(true);
  return unfold(await response.text());
}

test('After booking or moving, clients can choose Add to calendar for that saved booking and find it again in My bookings.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_3);
  });
  const booked = await step(page, 'Book a free session and see Add to calendar in the confirmation', async () => {
    const booked = await bookForCalendar(page, 41);
    await expect(page.getByTestId('booking-confirmation')).toContainText(booked.when);
    await expect(page.getByTestId('confirmation-add-to-calendar')).toHaveAttribute('href', booked.path);
    return booked;
  });
  const original = await step(
    page,
    'Download the confirmed session with the clinic, practitioner, time and full length',
    async () => {
      const content = await downloadCalendar(page, page.getByTestId('confirmation-add-to-calendar'));
      checkAppointment(content, booked.startsAt);
      return content;
    },
  );
  const moved = await step(page, 'Move the session and download its new saved time from the confirmation', async () => {
    const moved = await moveForCalendar(page, booked.when, 42);
    const content = await downloadCalendar(page, page.getByTestId('confirmation-add-to-calendar'));
    checkAppointment(content, moved.startsAt);
    expect(content).not.toContain(`DTSTART:${utcValue(booked.startsAt)}`);
    expect(content.match(/^UID:.+$/m)?.[0]).toBe(original.match(/^UID:.+$/m)?.[0]);
    return { ...moved, content };
  });
  await step(page, 'Return to My bookings and download the same updated session again', async () => {
    await page.getByTestId('nav-my-bookings').click();
    const content = await downloadCalendar(
      page,
      bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('add-to-calendar'),
    );
    expect(content).toBe(moved.content);
  });
});

test('Booking and move confirmation emails include a calendar attachment matching the saved appointment.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => {
    await signIn(page, PATIENT_2);
  });
  const booked = await step(page, 'Book a free session', async () => bookForCalendar(page, 45));
  await step(page, 'Open its booking email attachment and compare it with My bookings', async () => {
    const attachment = await attachmentFor(PATIENT_2, booked.reference, `Booking confirmed: ${booked.when}`);
    checkAppointment(attachment, booked.startsAt);
    expect(attachment).toBe(
      await downloadCalendar(page, bookingRow(page, 'upcoming-bookings', booked.when).getByTestId('add-to-calendar')),
    );
  });
  const moved = await step(page, 'Move the session to a new day', async () => moveForCalendar(page, booked.when, 46));
  await step(page, 'Open its move email attachment and compare it with the saved new time', async () => {
    const attachment = await attachmentFor(PATIENT_2, booked.reference, `Booking rescheduled: ${moved.when}`);
    checkAppointment(attachment, moved.startsAt);
    expect(attachment).not.toContain(`DTSTART:${utcValue(booked.startsAt)}`);
    expect(attachment).toBe(
      await downloadCalendar(page, bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('add-to-calendar')),
    );
  });
});

// Cross-clinic sessions and booking references are also covered in tests/e2e/tenants.spec.ts.
test('Signed-out visitors and other clients cannot download someone’s calendar file, including across clinics.', async ({
  page,
  browser,
}) => {
  await step(page, 'Sign in as the client who owns the booking', async () => {
    await signIn(page, PATIENT_1);
  });
  const booked = await step(page, 'Book a session and open its private calendar file', async () => {
    const booked = await bookForCalendar(page, 49);
    checkAppointment(await downloadCalendar(page, page.getByTestId('confirmation-add-to-calendar')), booked.startsAt);
    return booked;
  });
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await step(other, 'Open the same file while signed out and see that access is refused', async () => {
      const response = await other.goto(booked.path);
      expect(response?.status()).toBe(401);
      await expect(other.getByText('Sign in as a client to download your calendar file.')).toBeVisible();
      expect(await response!.text()).not.toContain('BEGIN:VCALENDAR');
    });
    await step(other, 'Sign in as a different client and see that the booking file is unavailable', async () => {
      await signIn(other, PATIENT_2);
      const response = await other.goto(booked.path);
      expect(response?.status()).toBe(404);
      expect(await response!.text()).not.toContain('BEGIN:VCALENDAR');
      expect(response!.headers()['cache-control']).toContain('no-store');
    });
  } finally {
    await otherContext.close();
  }
});
