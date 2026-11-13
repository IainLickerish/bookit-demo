import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  CSV_HEADINGS,
  type ExportClinic,
  bookExportBooking,
  clinicPage,
  downloadBookings,
  downloadedName,
  settingsValues,
  signInToClinic,
  visibleReferences,
} from './csv-support';
import { londonDate, step } from './support';

async function filterBookings(page: Page, date: string, practitioner: string, status: string) {
  await page.getByTestId('admin-date').fill(date);
  await page.getByTestId('admin-practitioner').selectOption({ label: practitioner });
  await page.getByTestId('admin-status').selectOption(status);
  await page.getByTestId('admin-filter').click();
  await expect(page.getByTestId('admin-date')).toHaveValue(date);
}

async function reportBookings(page: Page) {
  const response = await page.request.get('/api/admin/reports?type=bookings');
  expect(response.status()).toBe(200);
  return (
    (await response.json()) as {
      bookings: {
        id: string;
        patientName: string;
        practitionerName: string;
        startsAt: string;
        endsAt: string;
        status: string;
        lateCancellation: boolean;
        phone: string | null;
      }[];
    }
  ).bookings;
}

// Register these journeys in each runner so every result belongs to its check file.
export const bookingDownloadChecks = [
  {
    title:
      'In both clinics, staff choosing “Export filtered bookings (CSV)” receive bookings.csv instead of an error for selections containing accented names and names in other alphabets; downloaded names retain their original letters, including combined accent marks.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      for (const clinic of clinics) {
        const page = await clinicPage(browser, clinic);
        await step(page, `Sign in as ${clinic.label} staff and see the fictional clients`, async () => {
          await signInToClinic(page, clinic);
          await page.goto('/admin');
          for (const name of clinic.clients) {
            await expect(page.getByTestId('admin-booking-row').filter({ hasText: name }).first()).toBeVisible();
          }
          await expect(page.getByTestId('admin-export')).toHaveText('Export filtered bookings (CSV)');
        });
        const rows = await step(page, 'Download the bookings file and read it as UTF-8', async () =>
          downloadBookings(page),
        );
        await step(
          page,
          'See every original letter, combined accent, quote and line break in the downloaded names',
          async () => {
            expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(clinic.clients.map(downloadedName)));
            // Byte-level equality matters here: normalising decomposed accents would change the stored name.
            for (const name of clinic.clients) {
              const expected = downloadedName(name);
              expect(Buffer.from(rows.find((row) => row[1] === expected)![1]!, 'utf8')).toEqual(
                Buffer.from(expected, 'utf8'),
              );
            }
          },
        );
      }
    },
  },
  {
    title:
      'For each clinic, downloaded booking references match exactly the selection made with practitioner, clinic date and status filters, including bookings with accented names.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      test.setTimeout(180_000);
      for (const clinic of clinics) {
        const client = await clinicPage(browser, clinic);
        const date = londonDate(44, new Date(clinic.now));
        const otherDate = londonDate(45, new Date(clinic.now));
        const practitioner = clinic.practitioners[0]!;
        const expected = await step(client, `Make fictional bookings and cancel one in ${clinic.label}`, async () => {
          await signInToClinic(client, clinic, 'patient2');
          const first = await bookExportBooking(client, clinic, date);
          const cancelled = await bookExportBooking(client, clinic, date);
          await client.locator(`[data-booking-id="${cancelled.id}"]`).getByTestId('cancel-booking').click();
          await expect(client.locator(`[data-booking-id="${cancelled.id}"]`).getByTestId('booking-status')).toHaveText(
            'Cancelled',
          );
          const otherPractitioner = clinic.practitioners[1]
            ? await bookExportBooking(client, clinic, date, clinic.practitioners[1])
            : null;
          const otherDay = await bookExportBooking(client, clinic, otherDate);
          return { first, cancelled, otherPractitioner, otherDay };
        });
        const staff = await clinicPage(browser, clinic);
        await step(
          staff,
          'Select each practitioner, day and status and compare the file with the matching bookings',
          async () => {
            await signInToClinic(staff, clinic);
            await staff.goto('/admin');
            const selections = [
              { practitioner, date, status: 'confirmed', ids: [expected.first.id] },
              { practitioner, date, status: 'cancelled', ids: [expected.cancelled.id] },
              ...(expected.otherPractitioner
                ? [
                    {
                      practitioner: clinic.practitioners[1]!,
                      date,
                      status: 'confirmed',
                      ids: [expected.otherPractitioner.id],
                    },
                  ]
                : []),
              { practitioner, date: otherDate, status: 'confirmed', ids: [expected.otherDay.id] },
              {
                practitioner: 'All practitioners',
                date,
                status: '',
                ids: [
                  expected.first.id,
                  expected.cancelled.id,
                  ...(expected.otherPractitioner ? [expected.otherPractitioner.id] : []),
                ],
              },
              { practitioner, date, status: '', ids: [expected.first.id, expected.cancelled.id] },
            ];
            for (const selection of selections) {
              await filterBookings(staff, selection.date, selection.practitioner, selection.status);
              const visible = await visibleReferences(staff);
              expect([...visible].sort()).toEqual([...selection.ids].sort());
              const rows = await downloadBookings(staff);
              expect(rows.map((row) => row[0])).toEqual(visible);
              expect(rows.every((row) => row[1] === clinic.clients[1])).toBe(true);
            }
          },
        );
        await step(staff, 'Clear the filters and see the new booking references in the full download', async () => {
          await staff.getByRole('link', { name: 'Clear filters', exact: true }).click();
          const rows = await downloadBookings(staff);
          expect(rows.map((row) => row[0])).toEqual(await visibleReferences(staff));
          expect(rows.map((row) => row[0])).toEqual(
            expect.arrayContaining(
              Object.values(expected)
                .filter((booking) => booking !== null)
                .map((booking) => booking.id),
            ),
          );
        });
      }
    },
  },
  {
    title: 'A selection with no bookings still downloads a file with the existing column headings and no booking rows.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      for (const clinic of clinics) {
        const page = await clinicPage(browser, clinic);
        await step(page, `Sign in to ${clinic.label} and download a populated selection`, async () => {
          await signInToClinic(page, clinic);
          await page.goto('/admin');
          expect((await downloadBookings(page)).length).toBeGreaterThan(0);
        });
        await step(page, 'Choose a day with no cancelled bookings and see an empty selection', async () => {
          await filterBookings(page, londonDate(210, new Date(clinic.now)), 'All practitioners', 'cancelled');
          await expect(page.getByTestId('admin-row-count')).toHaveText('0 bookings');
          await expect(page.getByText('No bookings match these filters.', { exact: true })).toBeVisible();
        });
        await step(page, 'Download an empty file with the same eight column headings', async () => {
          expect(await downloadBookings(page)).toEqual([]);
          expect(CSV_HEADINGS).toHaveLength(8);
        });
      }
    },
  },
  {
    title:
      'Clients and signed-out visitors cannot download bookings, even through the download address directly; staff from one clinic cannot download the other clinic’s bookings.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      for (const [index, clinic] of clinics.entries()) {
        const staff = await clinicPage(browser, clinic);
        await step(staff, `Download the Unicode bookings as authorised ${clinic.label} staff`, async () => {
          await signInToClinic(staff, clinic);
          await staff.goto('/admin');
          const rows = await downloadBookings(staff);
          expect(rows.map((row) => row[1])).toContain(downloadedName(clinic.clients[2]!));
          const ownPractitioners = clinic.practitioners;
          const otherClinic = clinics[1 - index];
          expect(rows.some((row) => row[2] === clinic.practitioners[0]!)).toBe(true);
          for (const row of rows) {
            expect(ownPractitioners).toContain(row[2]);
            if (otherClinic) expect(row[2]).not.toBe(otherClinic.practitioners[0]!);
          }
        });
        const client = await clinicPage(browser, clinic);
        await step(
          client,
          'Try the download address as a client and see a refusal without booking details',
          async () => {
            await signInToClinic(client, clinic, 'patient1');
            const response = await client.request.get('/api/admin/export');
            expect(response.status()).toBe(403);
            expect(response.headers()['content-disposition']).toBeUndefined();
            expect(await response.text()).toBe('Admin access required');
          },
        );
        const visitor = await clinicPage(browser, clinic);
        await step(
          visitor,
          'Try without signing in and with another clinic’s staff sign-in and see no bookings',
          async () => {
            await visitor.goto('/auth/sign-in');
            const unsigned = await visitor.request.get('/api/admin/export');
            expect(unsigned.status()).toBe(401);
            expect(await unsigned.text()).toBe('Sign-in required');
            // Both copies share a host, so copying cookies presents the actual foreign staff token to the other clinic.
            await visitor.context().addCookies(await staff.context().cookies());
            const other = clinics[1 - index];
            if (other) {
              const foreign = await visitor.request.get(`${other.url}/api/admin/export`);
              expect(foreign.status()).toBe(401);
              expect(foreign.headers()['content-disposition']).toBeUndefined();
              expect(await foreign.text()).toBe('Sign-in required');
            }
            await visitor.context().clearCookies();
            const otherDomain = clinic.name === 'acme' ? 'beacondental.test' : 'acmephysio.test';
            await visitor.getByTestId('sign-in-email').fill(`admin@${otherDomain}`);
            await visitor.getByTestId('sign-in-password').fill(Object.values(clinic.accounts)[0]!);
            await visitor.getByTestId('sign-in-submit').click();
            await expect(visitor).toHaveURL(/\/auth\/sign-in/);
            expect((await visitor.request.get('/api/admin/export')).status()).toBe(401);
          },
        );
      }
    },
  },
  {
    title:
      'A new companion owner check covers finding a fictional client’s booking, downloading the filtered file and checking its name and booking reference, then saving a clinic setting and restoring it; all existing owner checks remain unchanged and pass.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      for (const clinic of clinics) {
        const client = await clinicPage(browser, clinic);
        const date = londonDate(46, new Date(clinic.now));
        const booking = await step(client, `Make a booking for a fictional client in ${clinic.label}`, async () => {
          await signInToClinic(client, clinic, 'patient1');
          return bookExportBooking(client, clinic, date);
        });
        const staff = await clinicPage(browser, clinic);
        const before = await step(
          staff,
          'Find the client’s booking, check the downloaded name and reference and open settings',
          async () => {
            await signInToClinic(staff, clinic);
            await staff.goto('/admin');
            await filterBookings(staff, date, clinic.practitioners[0]!, 'confirmed');
            await expect(staff.getByTestId('admin-booking-row')).toHaveCount(1);
            await expect(staff.getByTestId('admin-booking-row')).toContainText(clinic.clients[0]!);
            const rows = await downloadBookings(staff);
            expect(rows).toHaveLength(1);
            expect(rows[0]!.slice(0, 2)).toEqual([booking.id, clinic.clients[0]]);
            await staff.getByTestId('admin-settings-link').click();
            return settingsValues(staff);
          },
        );
        try {
          await step(staff, 'Save a changed clinic name and see it saved', async () => {
            await staff.getByTestId('admin-clinic-name').fill(`${before.name} Test`);
            await staff.getByTestId('admin-save-settings').click();
            await expect(staff.getByTestId('admin-settings-saved')).toHaveText('Clinic settings saved.');
            await expect(staff.getByTestId('clinic-name')).toHaveText(`${before.name} Test`);
          });
        } finally {
          await step(staff, 'Restore the original clinic name and check the settings', async () => {
            await staff.goto('/admin/settings');
            await staff.getByTestId('admin-clinic-name').fill(before.name);
            await staff.getByTestId('admin-save-settings').click();
            await expect(staff.getByTestId('admin-settings-saved')).toHaveText('Clinic settings saved.');
            await expect(staff.getByTestId('clinic-name')).toHaveText(before.name);
            expect(await settingsValues(staff)).toEqual(before);
          });
        }
      }
    },
  },
  {
    title:
      'The file retains its existing columns, UTC date and time values, row order and optional phone handling; downloading leaves stored names, bookings and settings unchanged.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      for (const clinic of clinics) {
        const page = await clinicPage(browser, clinic);
        const before = await step(page, `Read ${clinic.label} settings and bookings before downloading`, async () => {
          await signInToClinic(page, clinic);
          await page.goto('/admin/settings');
          const settings = await settingsValues(page);
          await page.getByRole('link', { name: 'Back to bookings', exact: true }).click();
          const bookings = await reportBookings(page);
          expect(bookings.some((booking) => booking.phone === null)).toBe(true);
          expect(
            bookings.some((booking) => booking.phone === '+44 7700 900001' || booking.phone === '+44 7700 900002'),
          ).toBe(true);
          return { settings, bookings, visible: await visibleReferences(page) };
        });
        await step(page, 'Download and compare the columns, UTC times, booking order and optional phones', async () => {
          const rows = await downloadBookings(page);
          expect(rows.map((row) => row[0])).toEqual(before.visible);
          expect(rows).toEqual(
            before.bookings.map((booking) => [
              booking.id,
              downloadedName(booking.patientName),
              booking.practitionerName,
              booking.startsAt,
              booking.endsAt,
              booking.status,
              booking.lateCancellation ? 'yes' : 'no',
              booking.phone ? `'${booking.phone}` : '',
            ]),
          );
          for (const row of rows) {
            expect(row[3]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(row[4]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          }
        });
        await step(page, 'Reload the bookings and settings and see that downloading changed none of them', async () => {
          await page.reload();
          expect(await visibleReferences(page)).toEqual(before.visible);
          expect(await reportBookings(page)).toEqual(before.bookings);
          expect((await downloadBookings(page)).map((row) => row[1])).toEqual(
            before.bookings.map((booking) => downloadedName(booking.patientName)),
          );
          await page.getByTestId('admin-settings-link').click();
          expect(await settingsValues(page)).toEqual(before.settings);
        });
      }
    },
  },
  {
    title:
      'Invalid download filters still refuse the request without returning booking details; the existing export control, filters, page wording and settings journey remain unchanged.',
    run: async (browser: Browser, clinics: readonly ExportClinic[]) => {
      for (const clinic of clinics) {
        const page = await clinicPage(browser, clinic);
        await step(page, `Open ${clinic.label} bookings and use the existing export control`, async () => {
          await signInToClinic(page, clinic);
          await page.goto('/admin');
          await expect(page.getByRole('heading', { name: 'Clinic bookings', exact: true })).toBeVisible();
          await expect(page.getByTestId('admin-export')).toHaveText('Export filtered bookings (CSV)');
          await expect(page.getByTestId('admin-filter')).toHaveText('Filter bookings');
          expect((await downloadBookings(page)).length).toBeGreaterThan(0);
        });
        await step(
          page,
          'Try invalid dates, statuses, practitioner references and clinic selectors and receive no booking details',
          async () => {
            for (const query of [
              'date=2026-02-30',
              'status=unknown',
              'practitionerId=invalid',
              'status=confirmed&status=cancelled',
              'date=2026-10-25&date=2026-10-26',
              `tenant=${clinic.name === 'acme' ? 'beacon' : 'acme'}`,
              'product=BEACON',
              'databaseUrl=foreign',
            ]) {
              const response = await page.request.get(`/api/admin/export?${query}`);
              expect(response.status(), query).toBe(400);
              expect(response.headers()['content-disposition']).toBeUndefined();
              expect(await response.text()).toBe('Invalid booking filters');
            }
            await page.goto('/admin?date=2026-02-30');
            await expect(page.getByTestId('admin-filter-error')).toHaveText(
              'Choose a valid practitioner, calendar date and booking status.',
            );
            await expect(page.getByTestId('admin-booking-row')).toHaveCount(0);
            await expect(page.getByTestId('admin-export')).toHaveCount(0);
          },
        );
        await step(page, 'Clear the filters and follow the existing settings journey back to bookings', async () => {
          await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
          await expect(page.getByTestId('admin-practitioner')).toHaveValue('');
          await expect(page.getByTestId('admin-date')).toHaveValue('');
          await expect(page.getByTestId('admin-status')).toHaveValue('');
          await page.getByTestId('admin-settings-link').click();
          await expect(page.getByRole('heading', { name: 'Clinic settings', exact: true })).toBeVisible();
          await expect(page.getByTestId('admin-save-settings')).toHaveText('Save settings');
          await page.getByRole('link', { name: 'Back to bookings', exact: true }).click();
          await expect(page.getByTestId('admin-export')).toBeVisible();
        });
      }
    },
  },
];
