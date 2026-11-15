import { expect, test } from '@playwright/test';
import {
  ADMIN,
  PATIENT_1,
  PRACTITIONER,
  bookSlot,
  bookingRow,
  downloadBookingsCsv,
  londonDate,
  pickFreeSlot,
  sessionFor,
  step,
} from './support';

test('Staff can download filtered bookings with accents and other non-English letters preserved in client names, instead of an error page.', async ({
  browser,
}) => {
  const date = londonDate(21);
  const client = await sessionFor(browser, PATIENT_1);
  const booking = await step(client, 'Book a session as a client whose name has accents', async () => {
    const when = await bookSlot(client, (await pickFreeSlot(client, date)).id);
    const reference = await bookingRow(client, 'upcoming-bookings', when).getAttribute('data-booking-id');
    expect(reference).toBeTruthy();
    return { reference: reference!, when };
  });

  const staff = await sessionFor(browser, ADMIN);
  await step(staff, 'Find the confirmed session using practitioner, date and status filters', async () => {
    await staff.getByTestId('nav-admin').click();
    await staff.getByTestId('admin-practitioner').selectOption({ label: PRACTITIONER });
    await staff.getByTestId('admin-date').fill(date);
    await staff.getByTestId('admin-status').selectOption('confirmed');
    await staff.getByTestId('admin-filter').click();
    const row = staff
      .getByTestId('admin-booking-row')
      .filter({ has: staff.getByRole('cell', { name: booking.when, exact: true }) });
    await expect(row.getByRole('cell', { name: 'Zoë Brontë', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Confirmed', exact: true })).toBeVisible();
  });

  await step(staff, 'Download the filtered CSV and read the client name with its accents intact', async () => {
    const csv = await downloadBookingsCsv(staff);
    expect(csv).toContain('"Booking ID","Patient","Practitioner"');
    expect(csv).toContain(`"${booking.reference}","Zoë Brontë","${PRACTITIONER}"`);
    const records = csv.trimEnd().split('\r\n').slice(1);
    const rows = staff.getByTestId('admin-booking-row');
    expect(records).toHaveLength(await rows.count());
    for (const record of records) {
      expect(record).toContain('"confirmed"');
      expect(record).toContain(`"${PRACTITIONER}"`);
    }
  });

  await step(staff, 'Choose a day with no bookings and download just the column headings', async () => {
    await staff.getByTestId('admin-date').fill(londonDate(-1));
    await staff.getByTestId('admin-filter').click();
    await expect(staff.getByText('No bookings match these filters.')).toBeVisible();
    expect(await downloadBookingsCsv(staff)).toBe(
      '"Booking ID","Patient","Practitioner","Start (UTC)","End (UTC)","Status","Late cancellation","Phone"\r\n',
    );
  });
});
