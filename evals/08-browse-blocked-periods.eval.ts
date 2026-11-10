import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN, PRACTITIONER, sessionFor } from './support';

test('Staff can browse saved absences a page at a time and return to earlier entries', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await sessionFor(browser, ADMIN);
  const prefix = `Past training ${randomUUID()}`;
  const saved: string[] = [];
  await admin.goto('/admin/blocked-time');
  try {
    for (let i = 1; i <= 21; i++) {
      const reason = `${prefix} ${i}`;
      await admin.getByTestId('block-practitioner').selectOption({ label: PRACTITIONER });
      await admin.getByTestId('block-start').fill('2020-01-06T09:00');
      await admin.getByTestId('block-end').fill('2020-01-06T10:00');
      await admin.getByTestId('block-reason').fill(reason);
      await admin.getByTestId('block-save').click();
      await expect(admin.getByRole('status')).toHaveText('Blocked time saved.');
      await expect(
        admin.getByTestId('blocked-period').filter({ has: admin.getByText(reason, { exact: true }) }),
      ).toBeVisible();
      saved.push(reason);
    }
    await expect(admin.getByTestId('blocked-period')).toHaveCount(20);
    await expect(admin.getByText(`${prefix} 1`, { exact: true })).toHaveCount(0);
    await admin.getByRole('link', { name: 'Next page', exact: true }).click();
    await expect(admin.getByText(`${prefix} 1`, { exact: true })).toBeVisible();
    await expect(admin.getByTestId('blocked-period').filter({ hasText: prefix })).toHaveCount(1);
    await admin.getByRole('link', { name: 'Previous page', exact: true }).click();
    await expect(admin.getByTestId('blocked-period')).toHaveCount(20);
    await expect(admin.getByText(`${prefix} 21`, { exact: true })).toBeVisible();
  } finally {
    await admin.goto('/admin/blocked-time');
    for (const reason of saved.reverse()) {
      await admin
        .getByTestId('blocked-period')
        .filter({ has: admin.getByText(reason, { exact: true }) })
        .getByRole('button', { name: 'Remove blocked time' })
        .click();
      await expect(admin.getByText(reason, { exact: true })).toHaveCount(0);
    }
    await admin.context().close();
  }
});
