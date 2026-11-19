import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AdminBookingsPage from '@/app/admin/page';
import SignInPage from '@/app/auth/sign-in/page';
import { DayPicker } from '@/app/day-picker';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import { SlotList } from '@/app/slot-list';
import { listAdminBookings, listAdminPractitioners } from '@/server/admin/bookings';
import { requireAdmin } from '@/server/admin/context';
import { currentUser } from '@/server/request-context';
import { loadClinicSettings, type ClinicSettings } from '@/server/settings';
import type { DayView } from '@/server/slots/day-view';

vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/request-context', () => ({ currentUser: vi.fn() }));
vi.mock('@/server/admin/context', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/server/admin/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/admin/bookings')>()),
  listAdminBookings: vi.fn(),
  listAdminPractitioners: vi.fn(),
}));
vi.mock('@/server/settings', () => ({ loadClinicSettings: vi.fn() }));

const settings: ClinicSettings = {
  clinicName: 'Test Physio',
  timeZone: 'Europe/London',
  lateCancellationHours: 24,
  includeContactInConfirmation: false,
  slotHorizonDays: 220,
  sessionMinutes: 45,
  maxReschedulesPerBooking: 3,
};
const practitioner = { id: '019a0000-0000-7000-8000-00000000a001', name: 'Pat Physio', bio: '' };

describe('BookIt page presentation', () => {
  it('serves both typefaces from bundled webfont files', () => {
    const css = readFileSync(new URL('../../src/app/fonts/faces.css', import.meta.url), 'utf8');
    expect(css).toContain("font-family: 'Figtree'");
    expect(css).toContain("font-family: 'Fraunces'");
    for (const [, file] of css.matchAll(/url\('([^']+)'\)/g)) {
      expect(file).toMatch(/^\.\/[\w-]+\.woff2$/);
      expect(readFileSync(new URL(`../../src/app/fonts/${file}`, import.meta.url)).toString('ascii', 0, 4)).toBe(
        'wOF2',
      );
    }
    expect(css.match(/url\(/g)).toHaveLength(5);
  });

  it('marks today and keeps the day picker and time choices on their existing destinations', () => {
    const slot = {
      id: 'slot-1',
      practitionerId: practitioner.id,
      practitionerName: practitioner.name,
      startsAt: new Date('2026-11-19T09:30:00Z'),
      endsAt: new Date('2026-11-19T10:15:00Z'),
    };
    const view: DayView = {
      settings,
      date: '2026-11-19',
      today: '2026-11-19',
      lastDate: '2026-11-20',
      practitioner,
      practitioners: [practitioner],
      slots: [slot],
    };
    const picker = renderToStaticMarkup(createElement(DayPicker, { view, path: '/slots' }));
    expect(picker).toContain('class="day-tile day-tile--today"');
    expect(picker).toContain('action="/slots"');
    expect(picker).toContain(`href="/slots?practitioner=${practitioner.id}&amp;date=2026-11-20"`);
    expect(picker).not.toContain('data-testid="previous-day"');

    const lastDay = renderToStaticMarkup(
      createElement(DayPicker, { view: { ...view, date: '2026-11-20' }, path: '/slots' }),
    );
    expect(lastDay).toContain(`href="/slots?practitioner=${practitioner.id}&amp;date=2026-11-19"`);
    expect(lastDay).not.toContain('day-tile--today');
    expect(lastDay).not.toContain('data-testid="next-day"');

    const times = renderToStaticMarkup(
      createElement(SlotList, {
        slots: view.slots,
        timeZone: settings.timeZone,
        renderChoice: (choice, label) => createElement('a', { href: `/book/${choice.id}` }, label),
      }),
    );
    expect(times).toContain('tabular-nums');
    expect(times).toContain('<a href="/book/slot-1">Thu, 19 Nov 2026, 09:30</a>');
  });

  it('shows sign-in notices inside the card with the same fields and reset link', async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await SignInPage({ searchParams: Promise.resolve({ error: 'invalid', notice: 'password_reset' }) }),
    );
    expect(html).toContain('class="narrow-page card"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Your password has been changed. Sign in with your new password.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('The email address or password is not correct.');
    expect(html).toMatch(/<input[^>]+type="email"[^>]+name="email"/);
    expect(html).toMatch(/<input[^>]+type="password"[^>]+name="password"/);
    expect(html).toContain('href="/auth/forgot-password"');
  });

  it('keeps filtered staff rows and the matching export in a keyboard-scrollable layout', async () => {
    vi.mocked(loadClinicSettings).mockResolvedValue(settings);
    vi.mocked(listAdminPractitioners).mockResolvedValue([practitioner]);
    vi.mocked(listAdminBookings).mockResolvedValue([
      {
        id: 'booking-1',
        patientName: 'Test Patient',
        practitionerId: practitioner.id,
        practitionerName: practitioner.name,
        startsAt: new Date('2026-11-19T09:30:00Z'),
        endsAt: new Date('2026-11-19T10:15:00Z'),
        status: 'cancelled',
        lateCancellation: true,
        phone: null,
      },
    ]);
    const filters = { practitionerId: practitioner.id, date: '2026-11-19', status: 'cancelled' };
    const html = renderToStaticMarkup(await AdminBookingsPage({ searchParams: Promise.resolve(filters) }));
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(listAdminBookings).toHaveBeenCalledWith(undefined, filters, settings.timeZone);
    expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*" role="region"[^>]+tabindex="0"/i);
    expect(html).toContain('<th scope="col">Appointment</th>');
    expect(html).toContain('<td>Test Patient</td>');
    expect(html).toContain('status-pill--cancelled">Cancelled (late)');
    expect(html).toContain(
      `href="/api/admin/export?practitionerId=${practitioner.id}&amp;date=2026-11-19&amp;status=cancelled"`,
    );
  });

  it('presents both recovery pages in cards with the existing next steps', () => {
    const reset = vi.fn();
    const errorPage = ErrorPage({ error: new Error('Test error'), reset });
    const errorHtml = renderToStaticMarkup(errorPage);
    expect(errorHtml).toContain('class="narrow-page card" role="alert"');
    expect(errorHtml).toContain('Please try again. If it keeps happening, contact the clinic.');
    expect(errorHtml).toContain('data-testid="retry-page">Try again</button>');
    const [, retry] = errorPage.props.children as [ReactElement, ReactElement<{ onClick: () => void }>];
    retry.props.onClick();
    expect(reset).toHaveBeenCalledOnce();

    const notFound = renderToStaticMarkup(createElement(NotFound));
    expect(notFound).toContain('class="narrow-page card"');
    expect(notFound).toContain('data-testid="not-found-start" href="/">Go to the start page</a>');
  });
});
