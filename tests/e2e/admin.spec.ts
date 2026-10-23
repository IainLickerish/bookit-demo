import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/db/client';
import { updateAdminSettings } from '../../src/server/admin/settings';
import { loadClinicSettings } from '../../src/server/settings';
import { seedAdminBookings } from '../helpers/admin-fixture';
import { adminEvidenceContext, adminLogEvidence } from '../helpers/admin-evidence';
import { manualClock } from '../helpers/clock';
import { E2E_START, loadState, serverLogLines, signIn } from './support';

const evidenceDirectory = `test-results/m0-24b/e2e-${randomUUID()}`;

test.afterEach(async ({ context }, testInfo) => {
  await mkdir(evidenceDirectory, { recursive: true });
  const safeLogs = adminLogEvidence(serverLogLines(), [
    loadState().password,
    ...(await context.cookies()).map((cookie) => cookie.value),
  ]);
  await writeFile(
    `${evidenceDirectory}/${testInfo.testId.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.json`,
    JSON.stringify(
      {
        ...adminEvidenceContext(),
        ...safeLogs,
        testId: testInfo.testId,
        test: testInfo.title,
        expected: testInfo.expectedStatus,
        observed: testInfo.status,
      },
      null,
      2,
    ),
  );
  expect(safeLogs.redaction.passed, 'server logs must not expose the test password or session cookies').toBe(true);
});

test.describe('BookIt admin journeys (REQ-18.1-01 REQ-18.1-03)', () => {
  test('admin pages and reports refuse unauthenticated and patient access', async ({ page }) => {
    for (const route of ['/admin', '/admin/settings']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
    }
    for (const route of ['/api/admin/export', '/api/admin/reports?type=bookings']) {
      const response = await page.request.get(route);
      expect(response.status()).toBe(401);
      expect(await response.text()).toBe('Sign-in required');
    }
    await signIn(page, loadState().patient1);
    for (const route of ['/admin', '/admin/settings']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/bookings$/);
    }
    for (const route of ['/api/admin/export', '/api/admin/reports?type=bookings']) {
      expect((await page.request.get(route)).status()).toBe(403);
    }
    await expect(page.getByTestId('nav-admin')).toHaveCount(0);
  });

  test('admin filters, downloads a Unicode CSV, saves settings and cannot reuse the action as a patient', async ({
    page,
  }) => {
    const state = loadState();
    const handle = createDatabase(state.databaseUrl);
    const clock = manualClock(E2E_START);
    const before = await loadClinicSettings(handle.db);
    try {
      const fixture = await seedAdminBookings(handle.db, clock, 'admin-e2e');
      await page.goto('/auth/sign-in');
      await page.getByTestId('sign-in-email').fill('admin@example.test');
      await page.getByTestId('sign-in-password').fill(state.password);
      await page.getByTestId('sign-in-submit').click();
      await page.getByTestId('nav-admin').click();
      await expect(page.getByRole('heading', { name: 'Clinic bookings' })).toBeVisible();
      await page.getByTestId('admin-practitioner').selectOption(fixture.practitionerId);
      await page.getByTestId('admin-filter').click();
      await expect(page.getByTestId('admin-booking-row')).toHaveCount(4);
      for (const name of ['Zoë Brontë', 'Łukasz Wiśniewski', 'Siobhán Ó Briain']) {
        await expect(page.getByTestId('admin-booking-row').filter({ hasText: name })).toHaveCount(1);
      }
      const downloadEvent = page.waitForEvent('download');
      await page.getByTestId('admin-export').click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe('bookings.csv');
      const file = await download.path();
      expect(file).not.toBeNull();
      const bytes = await readFile(file!);
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
      for (const name of ['Zoë Brontë', 'Łukasz Wiśniewski', 'Siobhán Ó Briain'])
        expect(bytes.toString('utf8')).toContain(name);
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(`${evidenceDirectory}/fictional-bookings.csv`, bytes);

      await page.getByTestId('admin-date').fill('2026-10-25');
      await page.getByTestId('admin-status').selectOption('cancelled');
      await page.getByTestId('admin-filter').click();
      await expect(page.getByTestId('admin-booking-row')).toHaveCount(1);
      await expect(page.getByTestId('admin-booking-row')).toContainText('Siobhán Ó Briain');
      const filtered = await page.request.get(
        `/api/admin/export?date=2026-10-25&status=cancelled&practitionerId=${fixture.practitionerId}`,
      );
      expect(await filtered.text()).toContain('Siobhán Ó Briain');
      const unknown = await page.request.get('/api/admin/reports?type=unknown');
      expect(unknown.status()).toBe(400);
      expect(await unknown.text()).toBe('Unknown report type');
      expect((await page.request.get('/api/admin/export?tenant=beacon')).status()).toBe(400);

      await page.getByTestId('admin-settings-link').click();
      await page.getByTestId('admin-clinic-name').fill('Acme Admin Test');
      await page.getByTestId('admin-time-zone').fill('Europe/Paris');
      await page.getByTestId('admin-late-hours').fill('48');
      await page.getByTestId('admin-include-contact').uncheck();
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-saved')).toHaveText('Clinic settings saved.');
      await expect(page.getByTestId('clinic-name')).toHaveText('Acme Admin Test');
      const changed = {
        ...before,
        clinicName: 'Acme Admin Test',
        timeZone: 'Europe/Paris',
        lateCancellationHours: 48,
        includeContactInConfirmation: false,
      };
      expect(await loadClinicSettings(handle.db)).toEqual(changed);

      await page.getByTestId('admin-time-zone').fill('Not/AZone');
      await page.getByTestId('admin-save-settings').click();
      await expect(page.getByTestId('admin-settings-error')).toBeVisible();
      expect(await loadClinicSettings(handle.db)).toEqual(changed);
      // A stale privileged tab must recheck the session on the real server action.
      const otherTab = await page.context().newPage();
      try {
        await otherTab.goto('/');
        await otherTab.getByTestId('sign-out').click();
        await signIn(otherTab, state.patient1);
        await page.getByTestId('admin-clinic-name').fill('Patient override');
        await page.getByTestId('admin-time-zone').fill('Europe/London');
        await page.getByTestId('admin-save-settings').click();
        await expect(page).toHaveURL(/\/bookings$/);
      } finally {
        await otherTab.close();
      }
      expect(await loadClinicSettings(handle.db)).toEqual(changed);
      expect(serverLogLines()).toContainEqual(
        expect.objectContaining({ event: 'admin.export', tenant: 'test', row_count: 4 }),
      );
    } finally {
      await updateAdminSettings(handle.db, clock, {
        clinicName: before.clinicName,
        timeZone: before.timeZone,
        lateCancellationHours: before.lateCancellationHours,
        includeContactInConfirmation: before.includeContactInConfirmation,
      });
      await handle.pool.end();
    }
  });
});
