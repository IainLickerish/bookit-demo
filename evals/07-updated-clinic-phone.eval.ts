import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_2, bookSlot, londonDate, pickFreeSlot, sessionFor } from './support';

test('A client sees a newly saved clinic phone number on their next booking confirmation', async ({ browser }) => {
  const admin = await sessionFor(browser, ADMIN);
  await admin.goto('/admin/settings');
  const phoneField = admin.getByTestId('admin-clinic-phone');
  const originalPhone = await phoneField.inputValue();
  const clinicName = await admin.getByTestId('admin-clinic-name').inputValue();
  const clinicPhone = '+44 (20) 7946 0456';

  try {
    await phoneField.fill('');
    await admin.getByTestId('admin-save-settings').click();
    await expect(admin.getByTestId('admin-settings-saved')).toBeVisible();

    const client = await sessionFor(browser, PATIENT_2);
    const firstSlot = await pickFreeSlot(client, londonDate(18));
    await bookSlot(client, firstSlot.id);
    await expect(client.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(client.getByText('Need to change your appointment?')).toHaveCount(0);
    await expect(client.locator('a[href^="tel:"]')).toHaveCount(0);

    await admin.goto('/admin/settings');
    await phoneField.fill(clinicPhone);
    await admin.getByTestId('admin-save-settings').click();
    await expect(admin.getByTestId('admin-settings-saved')).toBeVisible();

    const nextSlot = await pickFreeSlot(client, londonDate(19));
    await bookSlot(client, nextSlot.id);
    await expect(client.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(client.getByText(`Need to change your appointment? Call ${clinicName} on`)).toBeVisible();
    const callLink = client.getByRole('link', { name: clinicPhone, exact: true });
    await expect(callLink).toBeVisible();
    await expect(callLink).toHaveAttribute('href', 'tel:+442079460456');
  } finally {
    await admin.goto('/admin/settings');
    await phoneField.fill(originalPhone);
    await admin.getByTestId('admin-save-settings').click();
    await expect(admin.getByTestId('admin-settings-saved')).toBeVisible();
  }
});
