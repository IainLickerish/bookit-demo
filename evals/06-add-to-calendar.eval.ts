import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PATIENT_2, PRACTITIONER, bookSlot, bookingRow, londonDate, pickFreeSlot, signIn } from './support';

test('A client can add a confirmed appointment to their calendar and download its new time after moving it', async ({
  page,
}) => {
  await signIn(page, PATIENT_2);
  const date = londonDate(19);
  const slot = await pickFreeSlot(page, date);
  const when = await bookSlot(page, slot.id);
  let row = bookingRow(page, 'upcoming-bookings', when);
  await row.getByText('Add to calendar', { exact: true }).click();
  await expect(row.getByRole('link', { name: 'Google Calendar', exact: true })).toHaveAttribute(
    'href',
    /calendar.google.com/,
  );
  await expect(row.getByRole('link', { name: 'Outlook', exact: true })).toHaveAttribute('href', /outlook.live.com/);

  const downloadFile = async () => {
    const pending = page.waitForEvent('download');
    await row.getByRole('link', { name: 'Apple Calendar / download calendar file', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    return (await readFile((await download.path())!, 'utf8')).replace(/\r\n /g, '');
  };
  const original = await downloadFile();
  expect(original).toContain('BEGIN:VCALENDAR');
  expect(original).toContain('Acme Physio');
  expect(original).toContain(PRACTITIONER);
  expect(original).toContain(`${date} ${slot.time} (Europe/London)`);
  const start = original.match(/DTSTART:(\d{8}T\d{6}Z)/)![1]!;
  const end = original.match(/DTEND:(\d{8}T\d{6}Z)/)![1]!;
  const instant = (value: string) =>
    Date.parse(value.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'));
  expect(instant(end) - instant(start)).toBe(45 * 60_000);
  expect(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(
      instant(start),
    ),
  ).toBe(slot.time);

  await row.getByTestId('reschedule-link').click();
  await page.getByTestId('date-input').fill(date);
  await page.getByTestId('show-slots').click();
  const target = page.getByTestId('reschedule-to').first();
  const movedWhen = ((await target.textContent()) ?? '').trim();
  await target.click();
  await expect(page).toHaveURL(/notice=rescheduled/);
  await page.getByTestId('nav-my-bookings').click();
  row = bookingRow(page, 'upcoming-bookings', movedWhen);
  await row.getByText('Add to calendar', { exact: true }).click();
  const moved = await downloadFile();
  expect(moved.match(/UID:.+/)?.[0]).toBe(original.match(/UID:.+/)?.[0]);
  expect(moved).toContain('SEQUENCE:1');
  expect(moved.match(/DTSTART:.+/)?.[0]).not.toBe(original.match(/DTSTART:.+/)?.[0]);
  await row.getByTestId('cancel-booking').click();
});
