import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  PATIENT_2,
  PATIENT_3,
  PRACTITIONER,
  bookingRow,
  dateInPeriod,
  londonDate,
  mailTo,
  showDay,
  signIn,
  slotOffered,
  step,
} from './support';

// Factory demos may use a private HTTP hostname instead of localhost. Give
// that test origin the same Clipboard API support as a local browser demo.
test.use({
  launchOptions: {
    args: [
      `--unsafely-treat-insecure-origin-as-secure=${new URL(process.env.EVAL_BASE_URL ?? 'http://localhost:4101').origin}`,
    ],
  },
});

interface Appointment {
  id: string;
  when: string;
  startsAt: string;
  slotId: string;
}

// These helpers only drive the screens. Each call belongs to a person's step below.
async function book(page: Page, date: string, phone = ''): Promise<Appointment> {
  await showDay(page, date);
  // Leave the first time free for the owner's existing working-day checks.
  const slot = page.getByTestId('slot-link').last();
  await expect(slot).toBeVisible();
  const slotId = (await slot.getAttribute('data-slot-id')) ?? '';
  const startsAt = (await slot.getAttribute('data-starts-at')) ?? '';
  await slot.click();
  const when = ((await page.getByTestId('book-when').textContent()) ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  await page.getByTestId('book-phone').fill(phone);
  await page.getByTestId('confirm-booking').click();
  await expect(page).toHaveURL(/\/bookings\?notice=booked$/);
  const row = bookingRow(page, 'upcoming-bookings', when);
  await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
  const id = (await row.getAttribute('data-booking-id')) ?? '';
  expect(id).not.toBe('');
  return { id, when, startsAt, slotId };
}

async function move(page: Page, appointment: Appointment): Promise<Appointment> {
  await page.goto('/bookings');
  await bookingRow(page, 'upcoming-bookings', appointment.when).getByTestId('reschedule-link').click();
  const target = page.getByTestId('reschedule-to').last();
  await expect(target).toBeVisible();
  const when = ((await target.textContent()) ?? '').trim();
  const startsAt = (await target.getAttribute('data-starts-at')) ?? '';
  const slotId = (await target.getAttribute('data-slot-id')) ?? '';
  await target.click();
  await expect(page).toHaveURL(/\/bookings\?notice=rescheduled$/);
  await expect(bookingRow(page, 'upcoming-bookings', when).getByTestId('booking-status')).toHaveText('Confirmed');
  return { ...appointment, when, startsAt, slotId };
}

async function openDetails(page: Page, appointment: Appointment): Promise<string> {
  await bookingRow(page, 'upcoming-bookings', appointment.when).getByTestId('add-to-calendar').click();
  await expect(page.getByRole('heading', { name: 'Add to calendar', exact: true })).toBeVisible();
  await expect(page.getByLabel('Calendar details', { exact: true })).toBeVisible();
  return page.getByTestId('calendar-details').inputValue();
}

function ukWhen(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

async function copyAndCheck(page: Page, details: string): Promise<void> {
  await page.bringToFront();
  await page.getByTestId('copy-calendar-details').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('calendar-copy-result')).toContainText('Calendar details copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(details);
}

const mailBase = () => process.env.EVAL_MAIL_URL ?? 'http://localhost:8025';

async function receivedEmail(address: string, before: Set<string>, subject: string) {
  const unseen = async () => (await mailTo(address)).filter((m) => !before.has(m.ID) && m.Subject === subject);
  await expect.poll(async () => (await unseen()).length, { timeout: 15_000 }).toBe(1);
  const [message] = await unseen();
  if (!message) throw new Error('The confirmation email is missing');
  const response = await fetch(`${mailBase()}/api/v1/message/${encodeURIComponent(message.ID)}`);
  expect(response.ok).toBe(true);
  return (await response.json()) as { Text: string; Attachments?: unknown[] | null };
}

function checkEmail(email: { Text: string; Attachments?: unknown[] | null }, appointment: Appointment, phone: string) {
  expect(email.Text).toContain(`Start: ${appointment.when}`);
  expect(email.Text).toContain(`End: ${ukWhen(new Date(new Date(appointment.startsAt).getTime() + 45 * 60_000))}`);
  expect(email.Text).toContain('Clinic: Acme Physio');
  expect(email.Text).toContain(`With: ${PRACTITIONER}`);
  expect(email.Text).toContain('Duration: 45 minutes');
  expect(email.Text).toContain('Time zone: Europe/London');
  expect(email.Attachments ?? []).toHaveLength(0);
  if (phone) expect(email.Text).toContain(`Contact phone: ${phone}`);
  else expect(email.Text).not.toContain('Contact phone:');
}

test('Clients can copy calendar details after booking or moving and from upcoming bookings in My bookings.', async ({
  page,
  context,
}) => {
  await step(page, 'Sign in and allow calendar details to be copied', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, PATIENT_2);
  });
  const appointment = await step(page, 'Book a free session and see its confirmation', async () =>
    book(page, londonDate(24)),
  );
  await step(page, 'Open Add to calendar after booking and copy the details', async () => {
    const details = await openDetails(page, appointment);
    await copyAndCheck(page, details);
    expect(details).toContain(`Start: ${appointment.when}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  await step(page, 'Copy using a browser without the newer clipboard controls', async () => {
    const details = await page.getByTestId('calendar-details').inputValue();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });
    try {
      await page.getByTestId('copy-calendar-details').press('Enter');
      await expect(page.getByTestId('calendar-copy-result')).toHaveText('Calendar details copied.');
      await expect(page.getByTestId('copy-calendar-details')).toBeFocused();
    } finally {
      await page.evaluate(() => Reflect.deleteProperty(navigator, 'clipboard'));
    }
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(details);
  });
  const moved = await step(page, 'Move the session and copy the new calendar details', async () => {
    const moved = await move(page, appointment);
    const details = await openDetails(page, moved);
    await copyAndCheck(page, details);
    expect(details).toContain(`Start: ${moved.when}`);
    expect(details).not.toContain(`Start: ${appointment.when}`);
    return moved;
  });
  await step(page, 'Return to My bookings later and copy the same current details', async () => {
    await page.getByTestId('calendar-back').click();
    await page.reload();
    const details = await openDetails(page, moved);
    await copyAndCheck(page, details);
    expect(details).toContain(`Start: ${moved.when}`);
  });
});

test('Calendar details match the saved clinic, practitioner, UK time and duration in winter and summer.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client', async () => signIn(page, PATIENT_2));
  for (const summer of [false, true]) {
    const appointment = await step(page, `Book a session in UK ${summer ? 'summer' : 'winter'} time`, async () =>
      book(page, dateInPeriod(summer, 35)),
    );
    await step(
      page,
      `Reload the saved ${summer ? 'summer' : 'winter'} session and check all calendar details`,
      async () => {
        await page.reload();
        const details = await openDetails(page, appointment);
        expect(details).toBe(
          [
            `Title: Acme Physio with ${PRACTITIONER}`,
            'Clinic: Acme Physio',
            `With: ${PRACTITIONER}`,
            `Start: ${ukWhen(new Date(appointment.startsAt))}`,
            `End: ${ukWhen(new Date(new Date(appointment.startsAt).getTime() + 45 * 60_000))}`,
            `Time zone: Europe/London (${summer ? 'BST' : 'GMT'})`,
            'Duration: 45 minutes',
          ].join('\n'),
        );
      },
    );
  }
});

test('Booking and move emails include current calendar details without attachments and preserve optional-phone behaviour.', async ({
  page,
}) => {
  await step(page, 'Sign in as a client who has no phone on file', async () => signIn(page, PATIENT_2));
  for (const [index, phone] of ['', '+44 7700 900123'].entries()) {
    const appointment = await step(
      page,
      `Book ${phone ? 'with an optional phone' : 'without a phone'} and read the calendar details in the email`,
      async () => {
        const before = new Set((await mailTo(PATIENT_2)).map((m) => m.ID));
        const appointment = await book(page, londonDate(26 + index), phone);
        checkEmail(
          await receivedEmail(PATIENT_2, before, `Booking confirmed: ${appointment.when}`),
          appointment,
          phone,
        );
        return appointment;
      },
    );
    await step(
      page,
      `Move the session ${phone ? 'with a phone' : 'without a phone'} and read the updated email`,
      async () => {
        const before = new Set((await mailTo(PATIENT_2)).map((m) => m.ID));
        const moved = await move(page, appointment);
        const email = await receivedEmail(PATIENT_2, before, `Booking moved: ${moved.when}`);
        checkEmail(email, moved, phone);
        expect(email.Text).not.toContain(`Start: ${appointment.when}`);
        expect(email.Text).toContain('update or remove the existing calendar event yourself');
      },
    );
  }
});

test('Only the booking client can retrieve their calendar summary, which excludes their personal contact details and private links.', async ({
  page,
  browser,
}) => {
  const appointment = await step(page, 'Sign in and book a session with an optional contact phone', async () => {
    await signIn(page, PATIENT_2);
    return book(page, londonDate(28), '+44 7700 900123');
  });
  const path = await step(page, 'Open your own calendar summary and see only event details', async () => {
    const details = await openDetails(page, appointment);
    expect(details).toContain('Clinic: Acme Physio');
    expect(details).not.toMatch(/900123|Łukasz|Wiśniewski|@|https?:|\/bookings|reset-password|token/i);
    expect(details).not.toContain(appointment.id);
    return new URL(page.url()).pathname;
  });
  const other = await browser.newPage();
  try {
    await step(other, 'Try opening that calendar summary while signed out', async () => {
      await other.goto(path);
      await expect(other).toHaveURL(/\/auth\/sign-in$/);
      await expect(other.getByTestId('calendar-details')).toHaveCount(0);
    });
    await step(other, 'Sign in as another client and try the same private summary', async () => {
      await signIn(other, PATIENT_3);
      await other.goto(path);
      await expect(other.getByTestId('not-found')).toBeVisible();
      await expect(other.getByTestId('calendar-details')).toHaveCount(0);
      await expect(other.locator('body')).not.toContainText(appointment.when);
    });
    await step(other, 'Sign in as staff and check that the client calendar summary stays private', async () => {
      await other.getByTestId('sign-out').click();
      await signIn(other, ADMIN);
      await other.goto(path);
      await expect(other).toHaveURL(new URL('/', other.url()).href);
      await expect(other.getByTestId('admin-home')).toBeVisible();
      await expect(other.getByTestId('calendar-details')).toHaveCount(0);
    });
    await step(page, 'Cancel your booking and see that its calendar summary is no longer offered', async () => {
      await page.goto('/bookings');
      await bookingRow(page, 'upcoming-bookings', appointment.when).getByTestId('cancel-booking').click();
      await expect(bookingRow(page, 'other-bookings', appointment.when).getByTestId('add-to-calendar')).toHaveCount(0);
      await page.goto(path);
      await expect(page.getByTestId('not-found')).toBeVisible();
      await expect(page.getByTestId('calendar-details')).toHaveCount(0);
    });
  } finally {
    await other.close();
  }
});

test('Moved bookings show the new time, and clients understand that existing calendar entries need manual updates.', async ({
  page,
}) => {
  const appointment = await step(page, 'Sign in and book a session', async () => {
    await signIn(page, PATIENT_2);
    return book(page, londonDate(29));
  });
  const path = await step(page, 'Open its calendar details and read the guidance about later changes', async () => {
    await openDetails(page, appointment);
    await expect(page.getByTestId('calendar-update-help')).toContainText('update or remove the existing event');
    await expect(page.getByTestId('calendar-update-help')).toContainText('BookIt does not update your calendar.');
    return new URL(page.url()).pathname;
  });
  const moved = await step(page, 'Move the session and see its new confirmed time and calendar reminder', async () => {
    const moved = await move(page, appointment);
    await expect(page.getByTestId('calendar-update-help')).toContainText('BookIt does not update your calendar.');
    return moved;
  });
  await step(
    page,
    'Reopen the original calendar page and see the new time with the manual update reminder',
    async () => {
      await page.goto(path);
      await page.reload();
      const details = await page.getByTestId('calendar-details').inputValue();
      expect(details).toContain(`Start: ${moved.when}`);
      expect(details).not.toContain(`Start: ${appointment.when}`);
      await expect(page.getByTestId('calendar-update-help')).toContainText('update or remove the existing event');
    },
  );
});

test('Failed email delivery preserves the confirmed booking, and failed copying offers a useful manual alternative.', async ({
  page,
}) => {
  // The local demo inbox rejects SMTP, exercising the real saved-booking path.
  // compose.yml enables this facility on the fictional local inbox.
  const original: unknown = await step(page, 'Sign in before booking a session', async () => {
    await signIn(page, PATIENT_2);
    const response = await fetch(`${mailBase()}/api/v1/chaos`);
    expect(response.ok, 'the local demo inbox allows controlled delivery failures').toBe(true);
    return response.json() as Promise<unknown>;
  });
  const setChaos = async (value: unknown) => {
    const response = await fetch(`${mailBase()}/api/v1/chaos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    expect(response.ok, 'the local demo inbox accepts the test delivery setting').toBe(true);
  };
  try {
    const appointment = await step(page, 'Confirm a session while email delivery is unavailable', async () => {
      await setChaos({ Sender: { ErrorCode: 550, Probability: 100 } });
      const before = new Set((await mailTo(PATIENT_2)).map((m) => m.ID));
      const appointment = await book(page, londonDate(30));
      await expect(page.getByTestId('notice')).toHaveText('Booking confirmed.');
      expect((await mailTo(PATIENT_2)).filter((m) => !before.has(m.ID))).toHaveLength(0);
      return appointment;
    });
    const moved = await step(
      page,
      'Move the session while email remains unavailable and reload its saved confirmation',
      async () => {
        const before = new Set((await mailTo(PATIENT_2)).map((m) => m.ID));
        const moved = await move(page, appointment);
        expect((await mailTo(PATIENT_2)).filter((m) => !before.has(m.ID))).toHaveLength(0);
        await page.reload();
        await expect(bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('booking-status')).toHaveText(
          'Confirmed',
        );
        return moved;
      },
    );
    await step(page, 'Try copying when your browser refuses and see the manual alternative', async () => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('Copying is unavailable')) },
        });
        Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
      });
      const details = await openDetails(page, moved);
      await page.reload();
      await page.getByTestId('copy-calendar-details').click();
      await expect(page.getByTestId('calendar-copy-result')).toContainText(
        'Copy the selected text yourself, or type the details into your calendar.',
      );
      const field = page.getByTestId('calendar-details');
      await expect(field).toBeFocused();
      expect(
        await field.evaluate((element: HTMLTextAreaElement) =>
          element.value.slice(element.selectionStart, element.selectionEnd),
        ),
      ).toBe(details);
      await expect(page.getByTestId('calendar-manual-help')).toBeVisible();
      expect(details).toContain(`Start: ${moved.when}`);
    });
  } finally {
    await step(page, 'Restore normal email delivery for the other client journeys', async () => setChaos(original));
  }
});

test('Existing owner journeys keep working, and copying changes no stored bookings or staff features.', async ({
  page,
  browser,
  context,
}) => {
  const appointment = await step(page, 'Sign in and book a session', async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, PATIENT_2);
    return book(page, londonDate(31));
  });
  const staff = await browser.newPage();
  try {
    const before = await step(staff, 'Find the confirmed session in the clinic diary', async () => {
      await signIn(staff, ADMIN);
      await staff.goto('/admin');
      await staff.getByTestId('admin-date').fill(londonDate(31));
      await staff.getByTestId('admin-filter').click();
      const row = staff.getByTestId('admin-booking-row').filter({ hasText: appointment.when });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Confirmed');
      await expect(staff.getByTestId('add-to-calendar')).toHaveCount(0);
      return row.innerText();
    });
    await step(page, 'Copy calendar details twice and see that the session is still confirmed', async () => {
      const details = await openDetails(page, appointment);
      await copyAndCheck(page, details);
      await copyAndCheck(page, details);
      await page.getByTestId('calendar-back').click();
      await page.reload();
      const row = bookingRow(page, 'upcoming-bookings', appointment.when);
      await expect(row).toHaveAttribute('data-booking-id', appointment.id);
      await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
    });
    await step(staff, 'Reload the clinic diary and see the same booking and staff controls', async () => {
      await staff.reload();
      await expect(staff.getByTestId('admin-booking-row').filter({ hasText: appointment.when })).toHaveText(before);
      await expect(staff.getByTestId('admin-settings-link')).toBeVisible();
      await expect(staff.getByTestId('add-to-calendar')).toHaveCount(0);
    });
    const moved = await step(page, 'Move the session after copying and see the original time become free', async () => {
      const moved = await move(page, appointment);
      expect(await slotOffered(page, londonDate(31), appointment.slotId)).toBe(true);
      return moved;
    });
    await step(page, 'Cancel the moved session and see it leave upcoming bookings', async () => {
      await page.goto('/bookings');
      await bookingRow(page, 'upcoming-bookings', moved.when).getByTestId('cancel-booking').click();
      await expect(bookingRow(page, 'other-bookings', moved.when).getByTestId('booking-status')).toHaveText(
        'Cancelled',
      );
      await expect(bookingRow(page, 'other-bookings', moved.when).getByTestId('add-to-calendar')).toHaveCount(0);
    });
  } finally {
    await staff.close();
  }
});
