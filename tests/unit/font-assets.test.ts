import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const fontCss = readFileSync(path.join(root, 'src/app/fonts.css'), 'utf8');

describe('fonts shipped with BookIt', () => {
  it('supplies a real WOFF2 file for every local font face', () => {
    const urls = [...fontCss.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]!);
    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url).toMatch(/^\/fonts\/(fraunces|figtree)-latin(-ext)?-wght-normal\.woff2$/);
      const bytes = readFileSync(path.join(root, 'public', url));
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
      expect(bytes.readUInt32BE(8)).toBe(bytes.length);
    }
  });

  it.each(['fraunces', 'figtree'])('ships the copyright and licence for %s', (family) => {
    const licence = readFileSync(path.join(root, `public/fonts/${family}-OFL.txt`), 'utf8');
    expect(licence).toMatch(new RegExp(`Copyright.*${family}`, 'i'));
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('includes the public font assets in the runtime container', () => {
    const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const runtime = dockerfile.split('AS runtime')[1];
    expect(runtime).toMatch(/^COPY --from=build \/app\/public \.\/public$/m);
  });
});
