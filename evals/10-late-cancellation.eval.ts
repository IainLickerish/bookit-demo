import { expect, type Page } from '@playwright/test';
import { HOUR, test, type CancellationClinic, type TestBooking } from './late-cancellation-support';
import { PATIENT_1, bookSlot, givePhone, signIn, step } from './support';

const row = (page: Page, booking: TestBooking) => page.locator(`[data-booking-id="${booking.id}"]`);
const staffRow = (page: Page, booking: TestBooking) =>
  page.getByTestId('admin-booking-row').filter({ hasText: booking.when });

async function cancel(page: Page, booking: TestBooking, late: boolean): Promise<void> {
  await page.goto('/bookings');
  await row(page, booking).getByTestId('cancel-booking').click();
  await expect(page.getByTestId('notice')).toHaveText(
    late ? 'Booking cancelled. This was a late cancellation.' : 'Booking cancelled.',
  );
  await expect(
    page.getByTestId('other-bookings').locator(`[data-booking-id="${booking.id}"]`).getByTestId('booking-status'),
  ).toHaveText(late ? 'Cancelled (late)' : 'Cancelled');
  await expect(page.getByTestId('upcoming-bookings').locator(`[data-booking-id="${booking.id}"]`)).toHaveCount(0);
}

async function filterStaff(page: Page, booking: TestBooking, status: 'confirmed' | 'cancelled') {
  await page.goto('/admin');
  await page.getByTestId('admin-date').fill(booking.date);
  await page.getByTestId('admin-status').selectOption(status);
  await page.getByTestId('admin-filter').click();
}

async function rebook(page: Page, booking: TestBooking): Promise<TestBooking> {
  await bookSlot(page, booking.slotId);
  const upcoming = page.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: booking.when });
  const id = (await upcoming.getAttribute('data-booking-id'))!;
  return { ...booking, id };
}

async function ordinaryBoundaries(
  clinic: CancellationClinic,
  page: Page,
  staff: Page,
  booking: TestBooking,
  hours: number,
) {
  clinic.advanceTo(booking.startsAt - hours * HOUR - 1);
  await clinic.refreshSignIn(page);
  await clinic.refreshSignIn(staff, 'admin');
  await cancel(page, booking, false);
  await filterStaff(staff, booking, 'cancelled');
  await expect(staffRow(staff, booking)).toHaveCount(1);
  await expect(staffRow(staff, booking)).toContainText('Cancelled');
  await expect(staffRow(staff, booking)).not.toContainText('(late)');
  const other = await clinic.client(page.context().browser()!, 2);
  expect(await clinic.offered(other, booking)).toBe(true);
  let next = await rebook(page, booking);
  clinic.advanceTo(booking.startsAt - hours * HOUR);
  await cancel(page, next, false);
  await filterStaff(staff, booking, 'cancelled');
  await expect(staffRow(staff, booking)).toHaveCount(2);
  for (const text of await staffRow(staff, booking).allTextContents()) expect(text).not.toContain('(late)');
  await filterStaff(staff, booking, 'confirmed');
  await expect(staffRow(staff, booking)).toHaveCount(0);
  expect(await clinic.offered(other, booking)).toBe(true);
  next = await rebook(page, booking);
  return next;
}

test('In both clinics, cancelling an upcoming booking inside the configured late window moves it from Upcoming to Past and cancelled with “Cancelled (late)”; the top success notice agrees and the result remains after reloading.', async ({
  browser,
  acme,
  beacon,
}) => {
  const page = await acme.visitor(browser);
  const acmeBooking = await step(page, 'Sign in and book an Acme session', async () => {
    await signIn(page, PATIENT_1);
    return acme.book(page);
  });
  await step(page, 'Cancel the session an hour before it starts and see it in Past and cancelled', async () => {
    acme.advanceTo(acmeBooking.startsAt - HOUR);
    await acme.refreshSignIn(page);
    await cancel(page, acmeBooking, true);
  });
  await step(page, 'Reload My bookings and see the same late cancellation and success notice', async () => {
    await page.reload();
    await expect(row(page, acmeBooking).getByTestId('booking-status')).toHaveText('Cancelled (late)');
    await expect(page.getByTestId('notice')).toContainText('late cancellation');
    await expect(row(page, acmeBooking).getByTestId('cancel-booking')).toHaveCount(0);
  });
  const dental = await beacon.visitor(browser);
  const beaconBooking = await step(dental, 'Sign in and book a Beacon appointment', async () => {
    await signIn(dental, 'patient1@patients.beacondental.test');
    return beacon.book(dental);
  });
  await step(dental, 'Cancel the appointment an hour before it starts and see its late status', async () => {
    beacon.advanceTo(beaconBooking.startsAt - HOUR);
    await beacon.refreshSignIn(dental);
    await cancel(dental, beaconBooking, true);
  });
  await step(dental, 'Reload and see that the Beacon cancellation is saved', async () => {
    await dental.reload();
    await expect(row(dental, beaconBooking).getByTestId('booking-status')).toHaveText('Cancelled (late)');
    await expect(dental.getByTestId('notice')).toContainText('late cancellation');
  });
});

test('The same clinic’s staff see that booking as “Cancelled (late)”, included under the Cancelled filter and excluded from Confirmed.', async ({
  browser,
  acme,
  beacon,
}) => {
  const page = await acme.visitor(browser);
  const bookings = await step(page, 'Book a session and an appointment in the two clinics', async () => {
    await signIn(page, PATIENT_1);
    const first = await acme.book(page);
    const dental = await beacon.client(browser);
    const second = await beacon.book(dental);
    return [
      { clinic: acme, client: page, booking: first },
      { clinic: beacon, client: dental, booking: second },
    ];
  });
  await step(page, 'Cancel both bookings inside their clinics’ late windows', async () => {
    for (const { clinic, client, booking } of bookings) {
      clinic.advanceTo(booking.startsAt - HOUR);
      await clinic.refreshSignIn(client);
      await cancel(client, booking, true);
    }
  });
  for (const item of bookings) {
    const staff = await item.clinic.visitor(browser);
    await step(
      staff,
      `Find the late cancellation under ${item.clinic.copy.tenant.settings.clinicName}’s Cancelled filter`,
      async () => {
        await signIn(staff, `admin@${item.clinic.copy.tenant.domain}`);
        await filterStaff(staff, item.booking, 'cancelled');
        await expect(staffRow(staff, item.booking)).toHaveCount(1);
        await expect(staffRow(staff, item.booking)).toContainText('Cancelled (late)');
        await staff.reload();
        await expect(staffRow(staff, item.booking)).toContainText('Cancelled (late)');
      },
    );
    await step(
      staff,
      `See the cancelled booking excluded from ${item.clinic.copy.tenant.settings.clinicName}’s Confirmed filter`,
      async () => {
        await filterStaff(staff, item.booking, 'confirmed');
        await expect(staffRow(staff, item.booking)).toHaveCount(0);
      },
    );
  }
});

test('Another client is offered the released time and can book it; if two clients try together, only one receives a confirmed booking.', async ({
  browser,
  acme,
}) => {
  const page = await acme.visitor(browser);
  const booking = await step(page, 'Book a session as the first client', async () => {
    await signIn(page, PATIENT_1);
    return acme.book(page);
  });
  await step(page, 'Cancel late and release the time', async () => {
    acme.advanceTo(booking.startsAt - HOUR);
    await acme.refreshSignIn(page);
    await cancel(page, booking, true);
  });
  const clients = await step(
    page,
    'See the released time offered to two other clients and open it for both',
    async () => {
      const clients = [await acme.client(browser, 2), await acme.client(browser, 3)];
      for (const client of clients) {
        expect(await acme.offered(client, booking)).toBe(true);
        await client.goto(`/book/${booking.slotId}`);
        await givePhone(client);
        await expect(client.getByTestId('confirm-booking')).toBeVisible();
      }
      return clients;
    },
  );
  await step(clients[0]!, 'Confirm both at once and see that only one client gets the booking', async () => {
    await Promise.all(clients.map((client) => client.getByTestId('confirm-booking').click()));
    for (const client of clients) {
      await expect(client).toHaveURL(/\/bookings\?notice=booked$|\?error=slot_unavailable$/);
    }
    const winners = clients.filter((client) => client.url().endsWith('/bookings?notice=booked'));
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    await expect(
      winner.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: booking.when }),
    ).toContainText('Confirmed');
    const loser = clients.find((client) => client !== winner)!;
    await expect(loser.getByTestId('booking-error')).toContainText('Please choose another.');
    await loser.goto('/bookings');
    await expect(
      loser.getByTestId('upcoming-bookings').getByTestId('booking-row').filter({ hasText: booking.when }),
    ).toHaveCount(0);
  });
  const staff = await acme.visitor(browser);
  await step(staff, 'Check the clinic diary has one confirmed booking and the cancelled history', async () => {
    await signIn(staff, 'admin@acmephysio.test');
    await filterStaff(staff, booking, 'confirmed');
    await expect(staffRow(staff, booking)).toHaveCount(1);
    await filterStaff(staff, booking, 'cancelled');
    await expect(staffRow(staff, booking)).toHaveCount(1);
    await expect(staffRow(staff, booking)).toContainText('Cancelled (late)');
    expect(await acme.offered(page, booking)).toBe(false);
  });
});

test('Cancelling exactly at the late-window boundary or earlier still shows “Cancelled” to client and staff, gives the ordinary success notice and releases the time. Check both clinic defaults and a changed clinic window.', async ({
  browser,
  acme,
  beacon,
}) => {
  test.setTimeout(180_000);
  const page = await acme.visitor(browser);
  const cases = await step(page, 'Book two times in each clinic before their cancellation windows', async () => {
    await signIn(page, PATIENT_1);
    const cases = [];
    for (const clinic of [acme, beacon]) {
      const client = clinic === acme ? page : await clinic.client(browser);
      cases.push({
        clinic,
        client,
        staff: await clinic.staff(browser),
        ordinary: await clinic.book(client, 8),
        changed: await clinic.book(client, 8),
      });
    }
    return cases;
  });
  const first = cases[0]!;
  const second = cases[1]!;
  const acmeInside = await step(page, 'Cancel just before and exactly at Acme’s 24-hour boundary', async () => {
    return ordinaryBoundaries(acme, page, first.staff, first.ordinary, 24);
  });
  const beaconInside = await step(
    second.client,
    'Cancel just before and exactly at Beacon’s 48-hour boundary',
    async () => {
      return ordinaryBoundaries(beacon, second.client, second.staff, second.ordinary, 48);
    },
  );
  await step(page, 'See the late status only after passing each default boundary', async () => {
    for (const [item, booking, hours] of [
      [first, acmeInside, 24],
      [second, beaconInside, 48],
    ] as const) {
      item.clinic.advanceTo(booking.startsAt - hours * HOUR + 1);
      await cancel(item.client, booking, true);
    }
  });
  const changedAcme = await step(
    page,
    'Change Acme to 6 hours and cancel before and exactly at its new boundary',
    async () => {
      await acme.window(first.staff, 6);
      return ordinaryBoundaries(acme, page, first.staff, first.changed, 6);
    },
  );
  const changedBeacon = await step(
    second.client,
    'Change Beacon to 6 hours and cancel before and exactly at its new boundary',
    async () => {
      await beacon.window(second.staff, 6);
      return ordinaryBoundaries(beacon, second.client, second.staff, second.changed, 6);
    },
  );
  await step(page, 'See the late status after passing each changed boundary', async () => {
    for (const [item, booking] of [
      [first, changedAcme],
      [second, changedBeacon],
    ] as const) {
      item.clinic.advanceTo(booking.startsAt - 6 * HOUR + 1);
      await cancel(item.client, booking, true);
      await filterStaff(item.staff, booking, 'cancelled');
      await expect(staffRow(item.staff, booking).filter({ hasText: 'Cancelled (late)' })).toHaveCount(1);
    }
  });
});

test('A booking that has started cannot be cancelled, and an already cancelled booking cannot be cancelled again. Refusals explain what happened and provide a way onward; a failed save shows a problem instead of cancellation success and leaves the booking confirmed and its time unavailable.', async ({
  browser,
  acme,
}) => {
  const page = await acme.visitor(browser);
  const bookings = await step(page, 'Book three sessions and leave an older My bookings tab open', async () => {
    await signIn(page, PATIENT_1);
    const started = await acme.book(page);
    const later = await acme.book(page);
    const fails = await acme.book(page);
    const stale = await page.context().newPage();
    await stale.goto('/bookings');
    return { started, later, fails, stale };
  });
  await step(page, 'Try to cancel from the older tab when the first session has started', async () => {
    acme.advanceTo(bookings.started.startsAt);
    await acme.refreshSignIn(page);
    await row(bookings.stale, bookings.started).getByTestId('cancel-booking').click();
    await expect(bookings.stale.getByTestId('booking-error')).toContainText('already started');
    await expect(bookings.stale.getByTestId('nav-book')).toBeVisible();
    await expect(bookings.stale.getByTestId('notice')).toHaveCount(0);
    await expect(row(bookings.stale, bookings.started).getByTestId('booking-status')).toHaveText('Confirmed');
  });
  const duplicate = await step(page, 'Cancel a later session late and keep an older tab for that session', async () => {
    const duplicate = await page.context().newPage();
    await duplicate.goto('/bookings');
    await cancel(page, bookings.later, true);
    return duplicate;
  });
  await step(duplicate, 'Try to cancel it again and see an explanation and a way to book', async () => {
    await row(duplicate, bookings.later).getByTestId('cancel-booking').click();
    await expect(duplicate.getByTestId('booking-error')).toHaveText('That booking is already cancelled.');
    await expect(duplicate.getByTestId('notice')).toHaveCount(0);
    await expect(duplicate.getByTestId('nav-book')).toBeVisible();
    await expect(row(duplicate, bookings.later).getByTestId('booking-status')).toHaveText('Cancelled (late)');
  });
  await step(page, 'See a problem when the remaining cancellation cannot be saved', async () => {
    await acme.failCancellationSave();
    try {
      await page.goto('/bookings');
      await row(page, bookings.fails).getByTestId('cancel-booking').click();
      await expect(page.getByTestId('error-page')).toBeVisible();
      await expect(page.getByTestId('error-page')).toContainText('Please try again.');
      await expect(page.getByTestId('error-page').getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(page.getByTestId('notice')).toHaveCount(0);
    } finally {
      await acme.restoreSaving();
    }
  });
  await step(
    page,
    'Reload and find the failed cancellation still confirmed and unavailable to another client',
    async () => {
      await page.goto('/bookings');
      await expect(row(page, bookings.fails).getByTestId('booking-status')).toHaveText('Confirmed');
      const other = await acme.client(browser, 2);
      expect(await acme.offered(other, bookings.fails)).toBe(false);
      const staff = await acme.staff(browser);
      await filterStaff(staff, bookings.fails, 'confirmed');
      await expect(staffRow(staff, bookings.fails)).toHaveCount(1);
      await filterStaff(staff, bookings.fails, 'cancelled');
      await expect(staffRow(staff, bookings.fails)).toHaveCount(0);
    },
  );
});

test('Clients can view and cancel only their own bookings in their own clinic. Signed-out visitors and other clients cannot cancel them; clients cannot open clinic-wide bookings, exports or settings.', async ({
  browser,
  acme,
  beacon,
}) => {
  const page = await acme.visitor(browser);
  const people = await step(page, 'Sign in as two Acme clients and a Beacon client', async () => {
    await signIn(page, PATIENT_1);
    return { stranger: await acme.client(browser, 2), foreign: await beacon.client(browser) };
  });
  const bookings = await step(
    page,
    'Book each client’s own time and leave the owner’s bookings open in another tab',
    async () => {
      const own = await acme.book(page);
      const decoy = await acme.book(people.stranger);
      const dental = await beacon.book(people.foreign);
      const stale = await page.context().newPage();
      await stale.goto('/bookings');
      return { own, decoy, dental, stale };
    },
  );
  await step(bookings.stale, 'Sign out, then try to cancel from the older tab and be asked to sign in', async () => {
    await page.getByTestId('sign-out').click();
    await row(bookings.stale, bookings.own).getByTestId('cancel-booking').click();
    await expect(bookings.stale).toHaveURL(/\/auth\/sign-in/);
    await expect(bookings.stale.getByTestId('booking-row')).toHaveCount(0);
  });
  await step(people.stranger, 'Try to view and cancel the owner’s session as the other Acme client', async () => {
    await people.stranger.goto('/bookings');
    await expect(row(people.stranger, bookings.own)).toHaveCount(0);
    await people.stranger.goto(`/bookings/${bookings.own.id}/reschedule`);
    await expect(people.stranger.getByTestId('current-when')).toHaveCount(0);
    await people.stranger.goto('/bookings');
    await row(people.stranger, bookings.decoy)
      .locator('input[name="bookingId"]')
      .evaluate((input, id) => {
        (input as HTMLInputElement).value = id;
      }, bookings.own.id);
    await row(people.stranger, bookings.decoy).getByTestId('cancel-booking').click();
    await expect(people.stranger.getByTestId('booking-error')).toHaveText('We could not find that booking.');
    await expect(people.stranger.getByTestId('nav-book')).toBeVisible();
  });
  await step(
    people.foreign,
    'Try to view and cancel the Acme session from Beacon and see no private details',
    async () => {
      await people.foreign.goto(`/bookings/${bookings.own.id}/reschedule`);
      await expect(people.foreign.getByTestId('current-when')).toHaveCount(0);
      await people.foreign.goto('/bookings');
      await expect(row(people.foreign, bookings.own)).toHaveCount(0);
      await row(people.foreign, bookings.dental)
        .locator('input[name="bookingId"]')
        .evaluate((input, id) => {
          (input as HTMLInputElement).value = id;
        }, bookings.own.id);
      await row(people.foreign, bookings.dental).getByTestId('cancel-booking').click();
      await expect(people.foreign.getByTestId('booking-error')).toHaveText('We could not find that booking.');
      await expect(row(people.foreign, bookings.dental).getByTestId('booking-status')).toHaveText('Confirmed');
    },
  );
  await step(
    people.stranger,
    'Try the clinic’s bookings, settings and download as a client and be refused',
    async () => {
      for (const client of [people.stranger, people.foreign]) {
        for (const url of ['/admin', '/admin/settings']) {
          await client.goto(url);
          await expect(client.getByTestId('admin-booking-row')).toHaveCount(0);
          await expect(client.getByTestId('admin-save-settings')).toHaveCount(0);
        }
        expect((await client.request.get('/api/admin/export')).status()).toBeGreaterThanOrEqual(400);
      }
    },
  );
  await step(page, 'Sign back in as the owner, see the unchanged booking and cancel it late', async () => {
    acme.advanceTo(bookings.own.startsAt - HOUR);
    await signIn(page, PATIENT_1);
    await expect(row(page, bookings.own).getByTestId('booking-status')).toHaveText('Confirmed');
    await cancel(page, bookings.own, true);
  });
});

test('Existing bookings remain unchanged until a permitted action changes them, and an existing upcoming confirmed booking can now be cancelled late. If it was the client’s last upcoming booking, My bookings shows the cancelled booking and a useful way to book another time.', async ({
  browser,
  acme,
}) => {
  const page = await acme.visitor(browser);
  const original = await step(page, 'Make an upcoming booking and keep a record of the saved bookings', async () => {
    await signIn(page, PATIENT_1);
    const own = await acme.book(page);
    const other = await acme.client(browser, 2);
    const untouched = await acme.book(other);
    const snapshot = await acme.sql('select row_to_json(booking)::text from booking order by id');
    return { own, untouched, snapshot };
  });
  await step(page, 'Open and reload client and staff lists without changing any saved bookings', async () => {
    await page.reload();
    await expect(row(page, original.own).getByTestId('booking-status')).toHaveText('Confirmed');
    const staff = await acme.staff(browser);
    await staff.goto('/admin');
    await staff.reload();
    await expect(staffRow(staff, original.own)).toContainText('Confirmed');
    expect(await acme.sql('select row_to_json(booking)::text from booking order by id')).toBe(original.snapshot);
  });
  await step(page, 'Cancel the existing confirmed booking late', async () => {
    acme.advanceTo(original.own.startsAt - HOUR);
    await acme.refreshSignIn(page);
    await cancel(page, original.own, true);
  });
  await step(page, 'See the last booking in Past and cancelled with a way to book another time', async () => {
    await page.reload();
    await expect(page.getByTestId('no-upcoming')).toBeVisible();
    await expect(page.getByTestId('no-upcoming').getByRole('link', { name: 'Book one' })).toBeVisible();
    await expect(row(page, original.own).getByTestId('booking-status')).toHaveText('Cancelled (late)');
    const other = await acme.client(browser, 2);
    await expect(row(other, original.untouched).getByTestId('booking-status')).toHaveText('Confirmed');
    const after = await acme.sql(
      `select row_to_json(booking)::text from booking where id = '${original.untouched.id}'`,
    );
    expect(original.snapshot.split('\n')).toContain(after);
    await page.getByTestId('no-upcoming').getByRole('link', { name: 'Book one' }).click();
    await expect(page.getByTestId('show-slots')).toBeVisible();
  });
});

test('All existing owner key flows pass unchanged, including booking and confirmation emails, moves, private bookings, simultaneous bookings, optional phone numbers, UK times through clock changes, sign-in, password recovery and staff tools.', async ({
  browser,
  acme,
}) => {
  test.setTimeout(540_000);
  const page = await acme.visitor(browser);
  await step(page, 'Sign in to the fresh clinic copy', async () => {
    await signIn(page, PATIENT_1);
    await expect(page.getByRole('heading', { name: 'My bookings' })).toBeVisible();
  });
  await step(
    page,
    'Complete the unchanged booking, email, move, privacy, simultaneous booking, phone and UK time checks',
    async () => {
      await acme.existingFlows(
        [
          '01-book-a-free-appointment.eval.ts',
          '02-no-double-booking.eval.ts',
          '03-cancel-or-move.eval.ts',
          '04-bookings-are-private.eval.ts',
          '05-times-are-right.eval.ts',
          '06-optional-phone.eval.ts',
          '07-clock-change-times.eval.ts',
        ],
        test.info().outputPath('existing-booking-flows'),
      );
      await page.reload();
      await expect(page.getByTestId('upcoming-bookings')).toBeVisible();
    },
  );
  await step(page, 'Complete the unchanged sign-in, password recovery and staff checks', async () => {
    await acme.existingFlows(
      ['08-signing-in.eval.ts', '09-staff-tools.eval.ts'],
      test.info().outputPath('existing-account-and-staff-flows'),
    );
    await signIn(page, PATIENT_1);
    await expect(page.getByRole('heading', { name: 'My bookings' })).toBeVisible();
  });
  await step(page, 'Book another session and see that a late cancellation now saves too', async () => {
    const booking = await acme.book(page, 30);
    acme.advanceTo(booking.startsAt - HOUR);
    await acme.refreshSignIn(page);
    await cancel(page, booking, true);
    await page.reload();
    await expect(row(page, booking).getByTestId('booking-status')).toHaveText('Cancelled (late)');
  });
});
