import { expect, test } from '@playwright/test';
import { ADMIN, PATIENT_1, bookSlot, londonDate, pickFreeSlot, sessionFor } from './support';

test('A client sees the clinic phone number after booking an appointment', async ({ browser }) => {
  const admin = await sessionFor(browser, ADMIN);
  await admin.goto('/admin/settings');
  const phoneField = admin.getByTestId('admin-clinic-phone');
  const originalPhone = await phoneField.inputValue();
  const clinicName = await admin.getByTestId('admin-clinic-name').inputValue();
  const clinicPhone = '+44 (20) 7946 0123';

  try {
    await phoneField.fill(clinicPhone);
    await admin.getByTestId('admin-save-settings').click();
    await expect(admin.getByTestId('admin-settings-saved')).toBeVisible();

    const client = await sessionFor(browser, PATIENT_1);
    const slot = await pickFreeSlot(client, londonDate(16));
    await bookSlot(client, slot.id);

    await expect(client.getByTestId('notice')).toHaveText('Booking confirmed.');
    await expect(client.getByText(`Need to change your appointment? Call ${clinicName} on`)).toBeVisible();
    const callLink = client.getByRole('link', { name: clinicPhone, exact: true });
    await expect(callLink).toBeVisible();
    await expect(callLink).toHaveAttribute('href', 'tel:+442079460123');
  } finally {
    // Leave the demo's clinic settings as they were before this check.
    await admin.goto('/admin/settings');
    await phoneField.fill(originalPhone);
    await admin.getByTestId('admin-save-settings').click();
    await expect(admin.getByTestId('admin-settings-saved')).toBeVisible();
  }
});
