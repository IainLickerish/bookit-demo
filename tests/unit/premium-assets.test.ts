import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

describe('self-hosted premium design assets', () => {
  it('ships real WOFF2 fonts and their redistribution licences', () => {
    for (const family of ['fraunces', 'figtree']) {
      for (const subset of ['latin', 'latin-ext']) {
        const font = readFileSync(path.join(root, `public/fonts/${family}-${subset}-wght-normal.woff2`));
        expect(font.subarray(0, 4).toString()).toBe('wOF2');
        expect(font.length).toBeGreaterThan(10_000);
      }
      const licence = readFileSync(path.join(root, `public/fonts/${family}-OFL.txt`), 'utf8');
      expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });

  it('includes the fonts and notice icons in the production container', () => {
    const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const runtime = dockerfile.split(' AS runtime')[1]!;
    // Next serves /fonts and /icons from public at runtime, not from .next.
    expect(runtime).toMatch(/^COPY (?:--from=\S+ )?(?:\/app\/)?public \.\/public$/m);
  });
});
