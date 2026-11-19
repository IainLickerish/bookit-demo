import { expect, it, vi } from 'vitest';
import { blockTimeAction } from '@/app/admin/block-time-action';
import { currentUser } from '@/server/request-context';

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('@/server/request-context', () => ({ currentUser: vi.fn() }));

it.each([
  ['review', '/auth/sign-in'],
  ['save', '/auth/sign-in'],
  ['review', '/bookings'],
  ['save', '/bookings'],
])('guards the %s action with staff access before reading or changing bookings (%s)', async (intent, destination) => {
  vi.mocked(currentUser).mockResolvedValue(
    destination === '/auth/sign-in'
      ? null
      : { id: 'patient', role: 'patient', name: 'Test Patient', email: 'patient@example.test', phone: null },
  );
  const fields = { practitionerId: '', start: '', end: '', reason: '' };
  const form = new FormData();
  form.set('intent', intent);
  await expect(blockTimeAction({ step: 'edit', fields }, form)).rejects.toThrow(destination);
});
