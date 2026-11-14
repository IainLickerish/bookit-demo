'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { adminSettingsInput, updateAdminSettings } from '@/server/admin/settings';
import { requestLogger } from '@/server/request-context';
import { SETTINGS_MESSAGES } from '@/app/messages';

export type SettingsFormValues = {
  clinicName: string;
  timeZone: string;
  lateCancellationHours: string;
  includeContactInConfirmation: boolean;
  remindersEnabled: boolean;
};

export type SettingsFormState = {
  values: SettingsFormValues;
  fieldErrors: Partial<Record<keyof typeof SETTINGS_MESSAGES.fields, string>>;
  error?: string;
  saved?: boolean;
};

export async function saveSettingsAction(_previous: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  await requireAdmin();
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const values: SettingsFormValues = {
    clinicName: text('clinicName'),
    timeZone: text('timeZone'),
    lateCancellationHours: text('lateCancellationHours'),
    includeContactInConfirmation: form.get('includeContactInConfirmation') === 'on',
    remindersEnabled: form.get('remindersEnabled') === 'on',
  };
  const parsed = adminSettingsInput.safeParse({
    ...values,
    lateCancellationHours: values.lateCancellationHours.trim() !== '' ? Number(values.lateCancellationHours) : NaN,
  });
  if (!parsed.success) {
    const fieldErrors: SettingsFormState['fieldErrors'] = {};
    for (const field of Object.keys(SETTINGS_MESSAGES.fields) as (keyof typeof SETTINGS_MESSAGES.fields)[]) {
      if (parsed.error.issues.some((issue) => issue.path[0] === field)) {
        fieldErrors[field] = SETTINGS_MESSAGES.fields[field];
      }
    }
    return { values, fieldErrors, error: SETTINGS_MESSAGES.invalid };
  }
  const log = await requestLogger();
  try {
    await updateAdminSettings(getDatabase(), getClock(), parsed.data);
    log.info({ event: 'admin.settings_updated' }, 'Clinic settings updated');
  } catch {
    log.error({ event: 'admin.settings_failed' }, 'Clinic settings could not be saved');
    return { values, fieldErrors: {}, error: SETTINGS_MESSAGES.unavailable };
  }
  revalidatePath('/', 'layout');
  return {
    values: { ...values, ...parsed.data, lateCancellationHours: String(parsed.data.lateCancellationHours) },
    fieldErrors: {},
    saved: true,
  };
}
