import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const calendarCriteria = [
  'Clients can copy calendar details after booking or moving and from upcoming bookings in My bookings.',
  'Booking and move emails include current calendar details without attachments and preserve optional-phone behaviour.',
  'Only the booking client can retrieve their calendar summary, which excludes their personal contact details and private links.',
];

interface Suite {
  file: string;
  specs: { title: string; tests: { expectedStatus: string }[] }[];
  suites?: Suite[];
}

it('loads every owner check and three calendar journeys with only Playwright beside the evals', () => {
  const isolated = mkdtempSync(path.join(tmpdir(), 'bookit-eval-discovery-'));
  try {
    cpSync(path.join(root, 'evals'), path.join(isolated, 'evals'), { recursive: true });
    mkdirSync(path.join(isolated, 'node_modules/@playwright'), { recursive: true });
    symlinkSync(path.join(root, 'node_modules/@playwright/test'), path.join(isolated, 'node_modules/@playwright/test'));
    const result = spawnSync(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', '-c', 'evals/', '--list', '--forbid-only', '--reporter=json'],
      {
        cwd: isolated,
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(isolated, 'discovery.json') },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const report = JSON.parse(readFileSync(path.join(isolated, 'discovery.json'), 'utf8')) as {
      suites: Suite[];
      errors: unknown[];
    };
    expect(report.errors).toEqual([]);
    const files = readdirSync(path.join(root, 'evals')).filter((file) => file.endsWith('.eval.ts'));
    expect(report.suites.map((suite) => suite.file).sort()).toEqual(files.sort());
    const specs = (suite: Suite): Suite['specs'] => [...suite.specs, ...(suite.suites ?? []).flatMap(specs)];
    for (const suite of report.suites) {
      expect(specs(suite).length, suite.file).toBeGreaterThan(0);
      for (const spec of specs(suite)) {
        expect(spec.tests.length, spec.title).toBeGreaterThan(0);
        for (const test of spec.tests) expect(test.expectedStatus, spec.title).toBe('passed');
      }
    }
    const titles = report.suites.flatMap(specs).map((spec) => spec.title);
    expect(report.suites.filter((suite) => suite.file === '10-calendar-details.eval.ts').flatMap(specs)).toHaveLength(
      3,
    );
    for (const title of calendarCriteria) expect(titles.filter((found) => found === title)).toHaveLength(1);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});
