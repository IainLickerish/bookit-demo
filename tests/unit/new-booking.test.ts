import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookSlotPage from '@/app/book/[slotId]/page';
import SlotsPage from '@/app/slots/page';
import { loadClinicSettings, type ClinicSettings } from '@/server/settings';
import { loadDayView, type DayView } from '@/server/slots/day-view';
import { findBookableSlot, isSlotFree, type SlotView } from '@/server/slots/queries';

vi.mock('@/db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('@/server/request-context', () => ({ requirePatient: vi.fn(async () => ({ phone: null })) }));
vi.mock('@/server/settings');
vi.mock('@/server/slots/day-view');
vi.mock('@/server/slots/queries');
vi.mock('@/app/bookings/actions', () => ({ bookAction: vi.fn() }));

const settings: ClinicSettings = {
  clinicName: 'Acme Physio',
  timeZone: 'Europe/London',
  lateCancellationHours: 24,
  includeContactInConfirmation: true,
  slotHorizonDays: 220,
  sessionMinutes: 45,
  maxReschedulesPerBooking: 3,
};
const pat = { id: 'pat', name: 'Pat Physio', bio: '' };
const sam = { id: 'sam', name: 'Sam Sports', bio: '' };
const slot: SlotView = {
  id: 'free-slot',
  practitionerId: sam.id,
  practitionerName: sam.name,
  startsAt: new Date('2026-10-24T08:00:00Z'),
  endsAt: new Date('2026-10-24T08:45:00Z'),
};
const dayView: DayView = {
  settings,
  practitioners: [pat, sam],
  practitioner: sam,
  date: '2026-10-24',
  today: '2026-10-20',
  lastDate: '2027-05-28',
  slots: [slot],
};

beforeEach(() => {
  vi.mocked(loadClinicSettings).mockResolvedValue(settings);
  vi.mocked(findBookableSlot).mockResolvedValue(slot);
  vi.mocked(isSlotFree).mockResolvedValue(true);
});

async function renderDay(date: string, slots: SlotView[]) {
  vi.mocked(loadDayView).mockResolvedValue({ ...dayView, date, slots });
  return renderToStaticMarkup(await SlotsPage({ searchParams: Promise.resolve({ practitioner: sam.id, date }) }));
}

describe('new session booking', () => {
  it('labels the physiotherapist, date and free times for the selected day', async () => {
    const html = await renderDay(dayView.date, dayView.slots);

    expect(html).toMatch(/<label[^>]*>Physiotherapist<select[^>]*name="practitioner"/);
    expect(html).toMatch(/<option[^>]*value="sam"[^>]*selected="">Sam Sports<\/option>/);
    expect(html).toMatch(/<label[^>]*>Date<input[^>]*type="date"[^>]*value="2026-10-24"/);
    expect(html).toMatch(/<h2[^>]*>Free times with Sam Sports<\/h2>/);
    expect(html).toMatch(/<a[^>]*href="\/book\/free-slot"[^>]*>Sat, 24 Oct 2026, 09:00<\/a>/);
  });

  it('shows who, when and how long before confirming and links back to the same choices', async () => {
    const html = renderToStaticMarkup(
      await BookSlotPage({ params: Promise.resolve({ slotId: slot.id }), searchParams: Promise.resolve({}) }),
    );

    expect(html).toMatch(/<dt[^>]*>Physiotherapist<\/dt><dd[^>]*>Sam Sports<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Date and time<\/dt><dd[^>]*>Sat, 24 Oct 2026, 09:00<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Length<\/dt><dd[^>]*>45 minutes<\/dd>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Confirm booking<\/button>/);
    expect(html).toMatch(
      /<a[^>]*href="\/slots\?practitioner=sam&amp;date=2026-10-24"[^>]*>Choose a different time<\/a>/,
    );
  });

  it('explains an empty day and lets the client try another day with the same physiotherapist', async () => {
    const html = await renderDay('2026-10-25', []);

    expect(html).toMatch(
      /<p[^>]*role="status"[^>]*>No free times on this day\. Choose another date and select Show times\.<\/p>/,
    );
    expect(html).toMatch(/<a[^>]*data-testid="next-day"[^>]*href="\/slots\?practitioner=sam&amp;date=2026-10-26"/);
    expect(html).not.toContain('data-testid="slot-link"');
  });
});
