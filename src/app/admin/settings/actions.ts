'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { adminSettingsInput, updateAdminSettings } from '@/server/admin/settings';
import { requestLogger } from '@/server/request-context';

export async function saveSettingsAction(form: FormData): Promise<void> {
  await requireAdmin();
  const hours = form.get('lateCancellationHours');
  const parsed = adminSettingsInput.safeParse({
    clinicName: form.get('clinicName'),
    timeZone: form.get('timeZone'),
    lateCancellationHours: typeof hours === 'string' && hours.trim() !== '' ? Number(hours) : NaN,
    includeContactInConfirmation: form.get('includeContactInConfirmation') === 'on',
  });
  if (!parsed.success) redirect('/admin/settings?error=invalid');
  const log = await requestLogger();
  let failed = false;
  try {
    await updateAdminSettings(getDatabase(), getClock(), parsed.data);
    log.info({ event: 'admin.settings_updated' }, 'Clinic settings updated');
  } catch {
    log.error({ event: 'admin.settings_failed' }, 'Clinic settings could not be saved');
    failed = true;
  }
  if (failed) redirect('/admin/settings?error=unavailable');
  revalidatePath('/', 'layout');
  redirect('/admin/settings?saved=1');
}
