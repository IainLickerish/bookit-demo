import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';
import { loadTenant } from '@/server/seed/tenant';
import { currentUser } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import type { PublicUser } from '@/server/users';

vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/server/request-context', () => ({ currentUser: vi.fn() }));
vi.mock('@/server/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/settings')>()),
  loadClinicSettings: vi.fn(),
}));
vi.mock('@/app/auth/actions', () => ({ signOut: vi.fn() }));

beforeEach(() => {
  vi.mocked(currentUser).mockResolvedValue(null);
});

const account = (role: PublicUser['role']): PublicUser => ({
  id: 'layout-test-person',
  name: 'Fictional layout visitor',
  email: 'layout@bookit.test',
  role,
  phone: null,
});

describe.each(['acme', 'beacon'] as const)('%s shared foundation', (tenantName) => {
  beforeEach(() => {
    vi.mocked(loadClinicSettings).mockResolvedValue(loadTenant(tenantName).settings);
  });

  it('keeps the configured spelling and home link without exposing signed-in navigation to visitors', async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: createElement('h1', null, 'Sign in') }));
    expect(html).toContain(loadTenant(tenantName).settings.clinicName);
    expect(html).toMatch(/<a(?=[^>]*href="\/")(?=[^>]*data-testid="clinic-name")[^>]*>/);
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('page-shell-wide');
    expect(html).not.toContain(tenantName === 'acme' ? 'Beacon Dental' : 'Acme Physio');
  });

  it('keeps client destinations and the narrow frame', async () => {
    vi.mocked(currentUser).mockResolvedValue(account('patient'));
    const html = renderToStaticMarkup(await RootLayout({ children: createElement('h1', null, 'My bookings') }));
    expect(html).toMatch(/<a(?=[^>]*href="\/slots")(?=[^>]*data-testid="nav-book")[^>]*>Book</);
    expect(html).toMatch(/<a(?=[^>]*href="\/bookings")(?=[^>]*data-testid="nav-my-bookings")[^>]*>My bookings</);
    expect(html).toContain('data-testid="sign-out"');
    expect(html).not.toContain('nav-admin');
    expect(html).not.toContain('page-shell-wide');
  });

  it('keeps staff navigation and allows the wider frame', async () => {
    vi.mocked(currentUser).mockResolvedValue(account('admin'));
    const html = renderToStaticMarkup(await RootLayout({ children: createElement('h1', null, 'Clinic bookings') }));
    expect(html).toMatch(/<a(?=[^>]*href="\/admin")(?=[^>]*data-testid="nav-admin")[^>]*>Clinic bookings</);
    expect(html).toContain('data-testid="sign-out"');
    expect(html).toContain('<main class="page-shell page-shell-wide"');
    expect(html).not.toContain('nav-book');
    expect(html).not.toContain('nav-my-bookings');
  });

  it('uses a saved clinic name without interpreting it as markup', async () => {
    vi.mocked(loadClinicSettings).mockResolvedValue({
      ...loadTenant(tenantName).settings,
      clinicName: 'Demo <script>clinic</script> & partners',
    });
    const html = renderToStaticMarkup(await RootLayout({ children: createElement('h1', null, 'Sign in') }));
    expect(html).toContain('Demo &lt;script&gt;clinic&lt;/script&gt; &amp; partners');
    expect(html).not.toContain('<script>clinic</script>');
  });
});
