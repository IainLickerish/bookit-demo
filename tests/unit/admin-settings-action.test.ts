import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettingsAction, type SettingsFormState } from '@/app/admin/settings/actions';
import { SETTINGS_MESSAGES } from '@/app/messages';
import { requireAdmin } from '@/server/admin/context';
import { updateAdminSettings } from '@/server/admin/settings';
import { revalidatePath } from 'next/cache';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock('@/server/admin/context', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/server/admin/settings', async (original) => ({
  ...(await original<typeof import('@/server/admin/settings')>()),
  updateAdminSettings: vi.fn(),
}));
vi.mock('@/server/request-context', () => ({
  requestLogger: vi.fn(async () => ({ info: vi.fn(), error: vi.fn() })),
}));

const initial: SettingsFormState = {
  values: {
    clinicName: 'Acme Physio',
    timeZone: 'Europe/London',
    lateCancellationHours: '24',
    includeContactInConfirmation: true,
    remindersEnabled: true,
  },
  fieldErrors: {},
};

function form(entries: Record<string, string> = {}) {
  const data = new FormData();
  // Both checkboxes are deliberately absent, as when staff untick them.
  for (const [name, value] of Object.entries({
    clinicName: 'Acme Test Clinic',
    timeZone: 'Europe/London',
    lateCancellationHours: '36',
    ...entries,
  }))
    data.set(name, value);
  return data;
}

beforeEach(() => vi.resetAllMocks());

describe('clinic settings form recovery (PR-10, DS-5)', () => {
  it('retains all submitted entries and unchecked choices, identifies the invalid field and makes no write', async () => {
    const result = await saveSettingsAction(initial, form({ timeZone: 'London' }));
    expect(result).toEqual({
      values: {
        clinicName: 'Acme Test Clinic',
        timeZone: 'London',
        lateCancellationHours: '36',
        includeContactInConfirmation: false,
        remindersEnabled: false,
      },
      fieldErrors: { timeZone: SETTINGS_MESSAGES.fields.timeZone },
      error: SETTINGS_MESSAGES.invalid,
    });
    expect(updateAdminSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { clinicName: '', timeZone: '', lateCancellationHours: '' },
    { clinicName: '   ', timeZone: 'London', lateCancellationHours: '1.5' },
  ])('identifies each invalid or missing entry without replacing its contents: %o', async (entries) => {
    const result = await saveSettingsAction(initial, form(entries));
    expect(result.values).toMatchObject(entries);
    expect(result.fieldErrors).toEqual(SETTINGS_MESSAGES.fields);
    expect(result.saved).not.toBe(true);
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });

  it('saves corrected entries with the reminder choice still off and clears previous errors', async () => {
    const invalid = await saveSettingsAction(initial, form({ timeZone: 'London' }));
    const result = await saveSettingsAction(invalid, form());
    expect(updateAdminSettings).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      clinicName: 'Acme Test Clinic',
      timeZone: 'Europe/London',
      lateCancellationHours: 36,
      includeContactInConfirmation: false,
      remindersEnabled: false,
    });
    expect(result).toEqual({ values: { ...invalid.values, timeZone: 'Europe/London' }, fieldErrors: {}, saved: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('retains entries after a failed save without claiming success', async () => {
    vi.mocked(updateAdminSettings).mockRejectedValueOnce(new Error('unavailable'));
    const result = await saveSettingsAction(initial, form({ remindersEnabled: 'on' }));
    expect(result.error).toBe(SETTINGS_MESSAGES.unavailable);
    expect(result.values).toMatchObject({ remindersEnabled: true, clinicName: 'Acme Test Clinic' });
    expect(result.saved).not.toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('checks staff access before validation or writes', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('sign-in required'));
    await expect(saveSettingsAction(initial, form())).rejects.toThrow('sign-in required');
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });
});
