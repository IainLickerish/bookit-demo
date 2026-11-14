import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@/server/users';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getDatabase: vi.fn(),
  saveTimeBlock: vi.fn(),
  listTimeBlocks: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/request-context', () => ({ currentUser: mocks.currentUser, requestLogger: vi.fn() }));
vi.mock('@/db/client', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('@/server/admin/time-blocks', () => ({
  saveTimeBlock: mocks.saveTimeBlock,
  listTimeBlocks: mocks.listTimeBlocks,
}));

import { saveBlockAction } from '@/app/admin/blocks/actions';
import BlockedTimePage from '@/app/admin/blocks/page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staff-only time management boundaries', () => {
  it.each([
    [null, '/auth/sign-in'],
    [{ id: 'patient', role: 'patient' } as PublicUser, '/bookings'],
  ])('refuses the page and action before reading blocks or saving any submitted fields', async (user, destination) => {
    mocks.currentUser.mockResolvedValue(user);
    const form = new FormData();
    form.set('practitionerId', '019a0000-0000-7000-8000-000000000001');
    form.set('reason', 'A reason that must never be saved');
    form.set('role', 'admin');
    form.set('tenant', 'acme');
    await expect(BlockedTimePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(`redirect:${destination}`);
    await expect(
      saveBlockAction({ values: { practitionerId: '', start: '', end: '', reason: '' }, errors: {} }, form),
    ).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.saveTimeBlock).not.toHaveBeenCalled();
    expect(mocks.listTimeBlocks).not.toHaveBeenCalled();
  });
});
