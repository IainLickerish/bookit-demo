import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';

describe('BookIt page appearance', () => {
  it('serves Fraunces and Figtree from bundled font files', () => {
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
    const error = renderToStaticMarkup(createElement(ErrorPage, { error: new Error('test'), reset() {} }));
    expect(error).toMatch(/<section[^>]*class="[^"]*\bcard\b[^"]*"[^>]*role="alert"/);
    expect(error).toMatch(/<h1[^>]*>Something went wrong<\/h1>/);
    expect(error).toMatch(/<button[^>]*class="button"[^>]*>Try again<\/button>/);

    const missing = renderToStaticMarkup(createElement(NotFound));
    expect(missing).toMatch(/<section[^>]*class="[^"]*\bcard\b[^"]*"/);
    expect(missing).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(missing).toMatch(/<a[^>]*class="button"[^>]*href="\/"[^>]*>Go to the start page<\/a>/);
  });
});
