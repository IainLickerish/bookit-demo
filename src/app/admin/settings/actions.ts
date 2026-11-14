'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { adminSettingsInput, updateAdminSettings } from '@/server/admin/settings';
import { requestLogger } from '@/server/request-context';

export interface SettingsFormState {
  error?: 'invalid' | 'unavailable';
  saved?: true;
}

export async function saveSettingsAction(_previous: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  await requireAdmin();
  const hours = form.get('lateCancellationHours');
  const reminders = form.get('remindersEnabled');
  const parsed = adminSettingsInput.safeParse({
    clinicName: form.get('clinicName'),
    timeZone: form.get('timeZone'),
    lateCancellationHours: typeof hours === 'string' && hours.trim() !== '' ? Number(hours) : NaN,
    includeContactInConfirmation: form.get('includeContactInConfirmation') === 'on',
    remindersEnabled: reminders === 'on' ? true : reminders === 'off' ? false : undefined,
  });
  if (!parsed.success) return { error: 'invalid' };
  const log = await requestLogger();
  let failed = false;
  try {
    await updateAdminSettings(getDatabase(), getClock(), parsed.data);
    log.info({ event: 'admin.settings_updated' }, 'Clinic settings updated');
  } catch {
    log.error({ event: 'admin.settings_failed' }, 'Clinic settings could not be saved');
    failed = true;
  }
  if (failed) return { error: 'unavailable' };
  revalidatePath('/', 'layout');
  return { saved: true };
}
