import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('defines the 24-hour clock setting once for clinic time formats', () => {
  const source = readFileSync(new URL('../../src/lib/time.ts', import.meta.url), 'utf8');

  expect(source.match(/\bhourCycle\s*:\s*['"]h23['"]/g)).toHaveLength(1);
});
