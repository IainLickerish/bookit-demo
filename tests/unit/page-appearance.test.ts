import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DayPicker } from '@/app/day-picker';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import { SlotList } from '@/app/slot-list';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

describe('BookIt page appearance', () => {
  it('bundles Fraunces and Figtree declarations and WOFF2 files', () => {
    const css = new URL('../../src/app/globals.css', import.meta.url);
    const globalStyles = readFileSync(css, 'utf8');
    const fontImport = /@import '([^']+\/fonts\.css)'/.exec(globalStyles)?.[1];
    expect(fontImport).toBeDefined();
    const fontStyles = new URL(fontImport!, css);
    const faces = readFileSync(fontStyles, 'utf8').match(/@font-face\s*\{[^}]+\}/g) ?? [];

    for (const [family, token] of [
      ['Fraunces', 'serif'],
      ['Figtree', 'sans'],
    ]) {
      expect(globalStyles).toContain(`--font-${token}: '${family}'`);
      const matchingFaces = faces.filter((face) => face.includes(`font-family: '${family}'`));
      expect(matchingFaces.length).toBeGreaterThan(0);

      for (const face of matchingFaces) {
        const source = /src:\s*url\((\.\/[^)]+\.woff2)\)/.exec(face)?.[1];
        expect(source).toBeDefined();
        expect(readFileSync(new URL(source!, fontStyles)).subarray(0, 4).toString()).toBe('wOF2');
      }
    }
  });

  it('renders the fallback titles and actions on shared cards', () => {
    const cardSection = /<section\b[^>]*class="(?:[^"\s]+\s+)*card(?:\s+[^"\s]+)*"/;
    const error = renderToStaticMarkup(createElement(ErrorPage, { error: new Error('test'), reset() {} }));
    expect(error).toMatch(cardSection);
    expect(error).toMatch(/<section[^>]*role="alert"/);
    expect(error).toMatch(/<h1[^>]*>Something went wrong<\/h1>/);
    expect(error).toMatch(/<button[^>]*class="button"[^>]*>Try again<\/button>/);

    const missing = renderToStaticMarkup(createElement(NotFound));
    expect(missing).toMatch(cardSection);
    expect(missing).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(missing).toMatch(/<a[^>]*class="button"[^>]*href="\/"[^>]*>Go to the start page<\/a>/);
  });

  it('marks today on the shared date card while keeping day navigation', () => {
    const practitioner = { id: 'pat', name: 'Pat Physio', bio: '' };
    const view = {
      settings: TEST_CLINIC_SETTINGS,
      practitioner,
      practitioners: [practitioner],
      date: '2026-11-20',
      today: '2026-11-20',
      lastDate: '2026-11-22',
      slots: [],
    };
    for (const path of ['/slots', '/bookings/example/reschedule']) {
      const today = renderToStaticMarkup(createElement(DayPicker, { view, path }));
      expect(today).toMatch(/<time[^>]*datetime="2026-11-20"[^>]*aria-current="date"[^>]*class="day-current(?:\s|")/i);
      expect(today).toMatch(/<span[^>]*class="(?:[^"\s]+\s+)*bg-clay(?:\s+[^"\s]+)*"[^>]*aria-hidden="true"/);
      expect(today).toContain(`href="${path}?practitioner=pat&amp;date=2026-11-21"`);
      expect(today).not.toContain('data-testid="previous-day"');

      const next = renderToStaticMarkup(createElement(DayPicker, { view: { ...view, date: '2026-11-21' }, path }));
      expect(next).toMatch(/datetime="2026-11-21"/i);
      expect(next).toContain(`href="${path}?practitioner=pat&amp;date=2026-11-20"`);
      expect(next).not.toContain('bg-clay');
    }
  });

  it('presents the existing empty times message as a status on a card', () => {
    const empty = renderToStaticMarkup(
      createElement(SlotList, { slots: [], timeZone: 'Europe/London', renderChoice: () => null }),
    );
    expect(empty).toMatch(
      /<p class="card [^"]*" role="status"[^>]*>No free times on this day\. Try another day\.<\/p>/,
    );
  });
});
