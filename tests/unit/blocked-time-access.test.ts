import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDatabase: vi.fn(),
  saveBlockedPeriod: vi.fn(),
  listBlockedPeriods: vi.fn(),
  requestLogger: vi.fn(),
}));
vi.mock('@/server/admin/context', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/db/client', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('@/server/admin/blocked-time', async (original) => ({
  ...(await original<object>()),
  saveBlockedPeriod: mocks.saveBlockedPeriod,
  listBlockedPeriods: mocks.listBlockedPeriods,
}));
vi.mock('@/server/request-context', () => ({ requestLogger: mocks.requestLogger }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
import { saveBlockedPeriodAction } from '@/app/admin/blocked-time/actions';
import BlockedTimePage from '@/app/admin/blocked-time/page';

beforeEach(() => {
  vi.clearAllMocks();
});
it.each(['patient', 'visitor', 'foreign staff session'])(
  'checks staff access before reading or saving blocked time for a %s',
  async () => {
    const denied = new Error('Access refused');
    mocks.requireAdmin.mockRejectedValue(denied);
    const previous = { values: { practitionerId: '', start: '', end: '', reason: '' }, errors: {} };
    await expect(saveBlockedPeriodAction(previous, new FormData())).rejects.toBe(denied);
    await expect(BlockedTimePage({ searchParams: Promise.resolve({}) })).rejects.toBe(denied);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.saveBlockedPeriod).not.toHaveBeenCalled();
    expect(mocks.listBlockedPeriods).not.toHaveBeenCalled();
    expect(mocks.requestLogger).not.toHaveBeenCalled();
  },
);
