import { beforeEach, expect, it, vi } from 'vitest';
import { signIn } from '@/app/auth/actions';
import { authenticate, createSession } from '@/server/auth/session';
import { currentUser, requirePatient } from '@/server/request-context';
const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: () => ({ set: mocks.set, get: () => undefined }),
  headers: () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/auth/session', async (original) => ({
  ...(await original<typeof import('@/server/auth/session')>()),
  authenticate: vi.fn(),
  createSession: vi.fn(),
}));
const destination = '/bookings/019a0000-0000-7000-8000-000000000001/cancel';
const patient = {
  id: 'fictional',
  name: 'Fictional Client',
  email: 'client@clinic.test',
  role: 'patient' as const,
  phone: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue(patient);
  vi.mocked(createSession).mockResolvedValue({
    token: 'synthetic-session-token',
    expiresAt: new Date('2026-10-20T19:00:00Z'),
  });
});
function form(returnTo: string) {
  const data = new FormData();
  data.set('email', patient.email);
  data.set('password', 'fictional-test-password');
  data.set('returnTo', returnTo);
  return data;
}
it('carries a signed-out client’s booking destination to sign-in without changing bookings', async () => {
  expect(await currentUser()).toBeNull();
  await expect(requirePatient(destination)).rejects.toThrow(
    `redirect:/auth/sign-in?returnTo=${encodeURIComponent(destination)}`,
  );
});
it('returns a client to the allowed booking destination after successful sign-in', async () => {
  await expect(signIn(form(destination))).rejects.toThrow(`redirect:${destination}`);
  expect(mocks.set).toHaveBeenCalledOnce();
});
it('retains the safe destination after a wrong password', async () => {
  vi.mocked(authenticate).mockResolvedValue(null);
  await expect(signIn(form(destination))).rejects.toThrow(
    `redirect:/auth/sign-in?error=invalid&returnTo=${encodeURIComponent(destination)}`,
  );
  expect(createSession).not.toHaveBeenCalled();
});
it('refuses external return destinations and keeps staff out of client destinations', async () => {
  await expect(signIn(form('https://other.example.test'))).rejects.toThrow('redirect:/bookings');
  vi.mocked(authenticate).mockResolvedValue({ ...patient, role: 'admin' });
  await expect(signIn(form(destination))).rejects.toThrow('redirect:/');
});
