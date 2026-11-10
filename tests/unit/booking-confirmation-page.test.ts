import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyBookingsPage from '@/app/bookings/page';
import { loadClinicSettings } from '@/server/settings';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/server/request-context', () => ({ requirePatient: async () => ({ id: 'patient-1' }) }));
vi.mock('@/server/settings', () => ({ loadClinicSettings: vi.fn() }));
vi.mock('@/server/bookings/queries', () => ({ listBookingsForPatient: async () => [] }));
vi.mock('@/app/bookings/actions', () => ({ cancelAction: vi.fn() }));

async function renderPage(notice?: string | string[]) {
  return renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve({ notice }) }));
}

describe('booking confirmation clinic phone', () => {
  beforeEach(() => {
    vi.mocked(loadClinicSettings).mockResolvedValue({
      ...TEST_CLINIC_SETTINGS,
      clinicPhone: '+44 (20) 7946 0123',
    });
  });

  it('shows the saved clinic number and a call link after booking', async () => {
    const html = await renderPage('booked');
    expect(html).toContain('Booking confirmed.');
    expect(html).toContain('data-testid="notice">Booking confirmed.</p>');
    expect(html).toContain('Need to change your appointment? Call Test Physio Clinic on');
    expect(html).toContain('href="tel:+442079460123"');
    expect(html).toContain('+44 (20) 7946 0123');
  });

  it.each([null, undefined, ''])('keeps confirmation working with no clinic number: %s', async (clinicPhone) => {
    vi.mocked(loadClinicSettings).mockResolvedValue({ ...TEST_CLINIC_SETTINGS, clinicPhone });
    const html = await renderPage('booked');
    expect(html).toContain('Booking confirmed.');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('Need to change');
  });

  it('uses the latest saved clinic number on the next confirmation', async () => {
    expect(await renderPage('booked')).toContain('+44 (20) 7946 0123');

    vi.mocked(loadClinicSettings).mockResolvedValue({
      ...TEST_CLINIC_SETTINGS,
      clinicPhone: '+44 (20) 7946 0456',
    });
    const html = await renderPage('booked');
    expect(html).toContain('+44 (20) 7946 0456');
    expect(html).toContain('href="tel:+442079460456"');
    expect(html).not.toContain('+44 (20) 7946 0123');
  });

  it.each([undefined, 'cancelled', 'cancelled_late', 'rescheduled', 'unknown'])(
    'does not add booking confirmation contact text to notice %s',
    async (notice) => {
      expect(await renderPage(notice)).not.toContain('tel:');
    },
  );
});
