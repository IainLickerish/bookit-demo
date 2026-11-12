import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import HomePage from '@/app/page';

const { currentUser, redirect } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('@/server/request-context', () => ({ currentUser }));
vi.mock('next/navigation', () => ({ redirect }));

beforeEach(() => vi.clearAllMocks());

describe('home destinations after the shared design refresh', () => {
  it('still sends a visitor to sign-in', async () => {
    currentUser.mockResolvedValue(null);
    await expect(HomePage()).rejects.toThrow('redirect:/auth/sign-in');
    expect(redirect).toHaveBeenCalledOnce();
  });

  it('still sends a client to their bookings', async () => {
    currentUser.mockResolvedValue({ role: 'patient' });
    await expect(HomePage()).rejects.toThrow('redirect:/bookings');
    expect(redirect).toHaveBeenCalledOnce();
  });

  it('gives staff the existing clinic tools without a redirect', async () => {
    currentUser.mockResolvedValue({ role: 'admin' });
    const html = renderToStaticMarkup(await HomePage());
    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain('Clinic administration');
    expect(html).toContain('You are signed in as the clinic admin.');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/settings"');
  });
});

describe('shared recovery screens', () => {
  it('keeps the error announcement, recovery advice and retry control', () => {
    const html = renderToStaticMarkup(ErrorPage({ error: new Error('Test failure'), reset: vi.fn() }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Please try again. If it keeps happening, contact the clinic.');
    expect(html).toContain('type="button"');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Test failure');
  });

  it('keeps the missing-page way back to the start', () => {
    const html = renderToStaticMarkup(NotFound());
    expect(html).toContain('Page not found');
    expect(html).toContain('Go to the start page');
    expect(html).toContain('href="/"');
  });
});
