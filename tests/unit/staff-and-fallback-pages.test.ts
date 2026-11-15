import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminBookingsPage from '@/app/admin/page';
import AdminSettingsPage from '@/app/admin/settings/page';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import { requireAdmin } from '@/server/admin/context';
import { listAdminBookings, listAdminPractitioners, type AdminBooking } from '@/server/admin/bookings';
import { loadTenant } from '@/server/seed/tenant';
import { loadClinicSettings } from '@/server/settings';

vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/server/admin/context', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/server/admin/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/admin/bookings')>()),
  listAdminBookings: vi.fn(),
  listAdminPractitioners: vi.fn(),
}));
vi.mock('@/server/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/settings')>()),
  loadClinicSettings: vi.fn(),
}));
vi.mock('@/app/admin/settings/actions', () => ({ saveSettingsAction: vi.fn() }));

const row: AdminBooking = {
  id: 'design-staff-booking',
  patientName: 'Fictional Clïent',
  practitionerId: '019a0000-0000-7000-8000-00000000d001',
  practitionerName: 'Fictional Practitioner',
  startsAt: new Date('2026-11-25T09:00:00Z'),
  endsAt: new Date('2026-11-25T09:45:00Z'),
  status: 'confirmed',
  lateCancellation: false,
  phone: null,
};

describe.each(['acme', 'beacon'] as const)('%s staff page states', (tenantName) => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: 'design-staff',
      name: 'Fictional Staff',
      email: 'staff@bookit.test',
      role: 'admin',
      phone: null,
    });
    vi.mocked(loadClinicSettings).mockResolvedValue(loadTenant(tenantName).settings);
    vi.mocked(listAdminPractitioners).mockResolvedValue([{ id: row.practitionerId, name: row.practitionerName }]);
    vi.mocked(listAdminBookings).mockResolvedValue([row]);
  });

  it('keeps filters, full booking words and export selection in the new cards', async () => {
    const html = renderToStaticMarkup(
      await AdminBookingsPage({
        searchParams: Promise.resolve({ date: '2026-11-25', status: 'confirmed', practitionerId: row.practitionerId }),
      }),
    );
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(listAdminBookings).toHaveBeenCalledWith(
      {},
      { date: '2026-11-25', status: 'confirmed', practitionerId: row.practitionerId },
      'Europe/London',
    );
    expect(html).toContain('class="card staff-filters"');
    expect(html).toContain('class="card staff-results"');
    expect(html).toContain('Fictional Clïent');
    expect(html).toContain('Wed, 25 Nov 2026, 09:00');
    expect(html).toContain('class="status-pill status-confirmed"');
    expect(html).toMatch(/<span[^>]*data-testid="admin-booking-status"[^>]*>Confirmed<\/span>/);
    expect(html).toContain('date=2026-11-25');
    expect(html).toContain('status=confirmed');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Clinic bookings in Europe/London"');
  });

  it('keeps the existing empty-result explanation and clear-filter action', async () => {
    vi.mocked(listAdminBookings).mockResolvedValue([]);
    const html = renderToStaticMarkup(await AdminBookingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('No bookings match these filters.');
    expect(html).toContain('class="card staff-results"');
    expect(html).toContain('Clear filters');
    expect(html).toContain('data-testid="admin-export"');
  });

  it('keeps the invalid-filter refusal without loading or exporting a selection', async () => {
    const html = renderToStaticMarkup(
      await AdminBookingsPage({ searchParams: Promise.resolve({ status: 'not-a-status' }) }),
    );
    expect(listAdminBookings).not.toHaveBeenCalled();
    expect(html).toContain('Choose a valid practitioner, calendar date and booking status.');
    expect(html).toContain('class="card staff-filters"');
    expect(html).not.toContain('data-testid="admin-export"');
    expect(html).not.toContain('data-testid="admin-results"');
  });

  it.each([false, true])('keeps cancelled wording including the late flag %s', async (lateCancellation) => {
    vi.mocked(listAdminBookings).mockResolvedValue([{ ...row, status: 'cancelled', lateCancellation }]);
    const html = renderToStaticMarkup(await AdminBookingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('class="status-pill status-cancelled"');
    expect(html).toContain(lateCancellation ? '>Cancelled (late)</span>' : '>Cancelled</span>');
  });

  it.each(['bookings', 'settings'] as const)('refuses %s before loading any clinic information', async (page) => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Fictional access refusal'));
    const render = page === 'bookings' ? AdminBookingsPage : AdminSettingsPage;
    await expect(render({ searchParams: Promise.resolve({}) })).rejects.toThrow('Fictional access refusal');
    expect(loadClinicSettings).not.toHaveBeenCalled();
    expect(listAdminBookings).not.toHaveBeenCalled();
    expect(listAdminPractitioners).not.toHaveBeenCalled();
  });

  it.each(['saved', 'invalid', 'unavailable'] as const)(
    'keeps the settings %s message and existing controls',
    async (state) => {
      const html = renderToStaticMarkup(
        await AdminSettingsPage({
          searchParams: Promise.resolve(state === 'saved' ? { saved: '1' } : { error: state }),
        }),
      );
      expect(html).toContain('class="card settings-form space-y-4"');
      expect(html).toContain(loadTenant(tenantName).settings.clinicName);
      for (const name of ['clinicName', 'timeZone', 'lateCancellationHours', 'includeContactInConfirmation'])
        expect(html).toContain(`name="${name}"`);
      expect(html).toContain('Save settings');
      expect(html).toContain('Back to bookings');
      expect(html).toContain(
        state === 'saved'
          ? 'Clinic settings saved.'
          : state === 'invalid'
            ? 'Enter a clinic name, a valid IANA time zone and a whole number of hours from 0 to 336.'
            : 'Settings could not be saved. Please try again.',
      );
      expect(html).toContain(state === 'saved' ? 'role="status"' : 'role="alert"');
    },
  );
});

it('keeps the error explanation and retry callback in the shared fallback card without rendering technical details', () => {
  const reset = vi.fn();
  const element = ErrorPage({ error: new Error('Fictional private diagnostic detail'), reset });
  const html = renderToStaticMarkup(element);
  expect(html).toContain('class="card card-centred fallback-card"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Something went wrong');
  expect(html).toContain('Please try again. If it keeps happening, contact the clinic.');
  expect(html).not.toContain('Fictional private diagnostic detail');
  const children = (element.props as { children: ReactElement<{ onClick?: () => void }>[] }).children;
  const button = children.find((child) => child.type === 'button');
  expect(button).toBeDefined();
  button!.props.onClick!();
  expect(reset).toHaveBeenCalledOnce();
});

it('keeps the missing-page heading and home destination in the shared fallback card', () => {
  const html = renderToStaticMarkup(createElement(NotFound));
  expect(html).toContain('class="card card-centred fallback-card"');
  expect(html).toContain('Page not found');
  expect(html).toContain('Go to the start page');
  expect(html).toMatch(/<a(?=[^>]*href="\/")(?=[^>]*data-testid="not-found-home")[^>]*>/);
});
