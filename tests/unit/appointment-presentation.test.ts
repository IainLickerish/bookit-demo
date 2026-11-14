import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateTile } from '@/app/date-tile';
import { SlotText } from '@/app/slot-text';
import { formatSlot } from '@/lib/time';

describe('appointment presentation in the clinic time zone', () => {
  it.each([
    ['2026-10-24T23:30:00Z', 'Europe/London', '25', 'Oct'],
    ['2026-10-25T23:30:00Z', 'Europe/London', '25', 'Oct'],
    ['2026-10-25T23:30:00Z', 'Asia/Tokyo', '26', 'Oct'],
    ['2026-11-01T00:30:00Z', 'America/New_York', '31', 'Oct'],
  ])('keeps the decorative tile on the clinic date for %s in %s', (iso, timeZone, day, month) => {
    const html = renderToStaticMarkup(createElement(DateTile, { instant: new Date(iso), timeZone }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`data-testid="date-tile-day">${day}</span>`);
    expect(html).toContain(`data-testid="date-tile-month">${month}</span>`);
  });

  it.each(['2026-10-24T23:30:00Z', '2026-10-25T01:30:00Z', '2026-11-01T00:30:00Z'])(
    'preserves the full appointment wording while emphasising its time for %s',
    (iso) => {
      const instant = new Date(iso);
      const html = renderToStaticMarkup(createElement(SlotText, { instant, timeZone: 'Europe/London' }));
      const words = html.replace(/<[^>]*>/g, '');
      expect(words).toBe(formatSlot(instant, 'Europe/London'));
      expect(html).toMatch(/data-testid="slot-time">\d{2}:\d{2}<\/span>/);
    },
  );
});
