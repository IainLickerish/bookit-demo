import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettingsAction } from '@/app/admin/settings/actions';
import { requireAdmin } from '@/server/admin/context';
import { adminSettingsInput, updateAdminSettings } from '@/server/admin/settings';
import { currentUser } from '@/server/request-context';
import { loadTenant } from '@/server/seed/tenant';
import { readFileSync } from 'node:fs';

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/request-context', () => ({
  currentUser: vi.fn(),
  requestLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/server/admin/settings', async (original) => ({
  ...(await original<typeof import('@/server/admin/settings')>()),
  updateAdminSettings: vi.fn(),
}));

const admin = { id: 'staff', email: 'staff@clinic.test', name: 'Staff', role: 'admin' as const, phone: null };
function form(reminders = 'on'): FormData {
  const data = new FormData();
  data.set('clinicName', 'Demo Clinic');
  data.set('timeZone', 'Europe/London');
  data.set('lateCancellationHours', '24');
  data.set('remindersEnabled', reminders);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUser).mockResolvedValue(admin);
  vi.mocked(updateAdminSettings).mockResolvedValue();
});

describe('reminder settings server boundary', () => {
  it.each([
    ['on', true],
    ['off', false],
  ] as const)('saves the explicit %s choice', async (choice, expected) => {
    await expect(saveSettingsAction({}, form(choice))).resolves.toEqual({ saved: true });
    expect(updateAdminSettings).toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      expect.objectContaining({ remindersEnabled: expected }),
    );
  });
  it.each(['', 'true', 'false', 'beacon'])('refuses an invalid reminder choice %j without saving', async (choice) => {
    expect(await saveSettingsAction({}, form(choice))).toEqual({ error: 'invalid' });
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });
  it('refuses a missing reminder choice without saving', async () => {
    const data = form();
    data.delete('remindersEnabled');
    expect(await saveSettingsAction({}, data)).toEqual({ error: 'invalid' });
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });
  it.each([null, { ...admin, role: 'patient' as const }])('refuses unauthorised page and save access', async (user) => {
    vi.mocked(currentUser).mockResolvedValue(user);
    const target = user ? '/bookings' : '/auth/sign-in';
    await expect(requireAdmin()).rejects.toThrow(`redirect:${target}`);
    await expect(saveSettingsAction({}, form())).rejects.toThrow(`redirect:${target}`);
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });
  it('returns a retryable failure without claiming the choice was saved', async () => {
    vi.mocked(updateAdminSettings).mockRejectedValueOnce(new Error('synthetic write failure'));
    expect(await saveSettingsAction({}, form())).toEqual({ error: 'unavailable' });
  });
  it('requires a boolean preference and refuses extra booking-rule fields', () => {
    const values = {
      clinicName: 'Clinic',
      timeZone: 'Europe/London',
      lateCancellationHours: 24,
      includeContactInConfirmation: false,
      remindersEnabled: true,
    };
    for (const value of ['true', 1, null, undefined]) {
      expect(adminSettingsInput.safeParse({ ...values, remindersEnabled: value }).success).toBe(false);
    }
    expect(adminSettingsInput.safeParse({ ...values, slotHorizonDays: 10 }).success).toBe(false);
  });
  it.each(['acme', 'beacon'] as const)('preserves the existing %s tenant seed fingerprint input', (name) => {
    const raw: unknown = JSON.parse(readFileSync(`tenants/${name}.json`, 'utf8'));
    expect(JSON.stringify(loadTenant(name))).toBe(JSON.stringify(raw));
  });
});
