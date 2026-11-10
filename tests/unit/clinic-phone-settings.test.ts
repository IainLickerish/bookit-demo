import { describe, expect, it, vi } from 'vitest';
import type { Executor } from '@/db/client';
import { loadClinicSettings } from '@/server/settings';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

describe('clinic phone settings', () => {
  it.each(['+44 (20) 7946 0123', null])('loads the stored clinic number: %s', async (clinicPhone) => {
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 1, ...TEST_CLINIC_SETTINGS, clinicPhone }]),
        }),
      }),
    } as unknown as Executor;

    const settings = await loadClinicSettings(db);
    expect(settings.clinicPhone).toBe(clinicPhone);
  });
});
