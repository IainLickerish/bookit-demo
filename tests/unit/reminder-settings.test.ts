import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveSettingsAction } from '@/app/admin/settings/actions';

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/db/client', () => ({ getDatabase: () => 'clinic-database' }));
vi.mock('@/server/request-context', () => ({
  currentUser: mocks.user,
  requestLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/server/admin/settings', async (original) => ({
  ...(await original<object>()),
  updateAdminSettings: mocks.update,
}));

afterEach(() => vi.resetAllMocks());

function form(enabled: boolean): FormData {
  const data = new FormData();
  data.set('clinicName', 'Test Clinic');
  data.set('timeZone', 'Europe/London');
  data.set('lateCancellationHours', '24');
  if (enabled) data.set('remindersEnabled', 'on');
  return data;
}

describe('reminder settings server action', () => {
  it('refuses visitors and clients before any write', async () => {
    for (const user of [null, { role: 'patient' }]) {
      mocks.user.mockResolvedValue(user);
      await expect(saveSettingsAction(form(false))).rejects.toThrow('redirect:');
      expect(mocks.update).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])('saves remindersEnabled=%s for clinic staff', async (enabled) => {
    mocks.user.mockResolvedValue({ role: 'admin' });
    mocks.update.mockResolvedValue(undefined);
    await expect(saveSettingsAction(form(enabled))).rejects.toThrow('redirect:/admin/settings?saved=1');
    expect(mocks.update).toHaveBeenCalledWith(
      'clinic-database',
      expect.anything(),
      expect.objectContaining({ remindersEnabled: enabled }),
    );
    expect(mocks.revalidate).toHaveBeenCalled();
  });
});
