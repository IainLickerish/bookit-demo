import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { JSONReport, JSONReportSpec, JSONReportSuite } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

function specsIn(suites: JSONReportSuite[]): JSONReportSpec[] {
  return suites.flatMap((suite) => [...suite.specs, ...specsIn(suite.suites ?? [])]);
}

it('loads every owner behaviour check without syntax errors, focused tests or skipped tests', () => {
  // Discovery loads every eval and its imports, without starting browsers, Docker or a demo.
  const result = spawnSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '-c', 'evals', '--list', '--forbid-only', '--reporter=json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: '',
        PLAYWRIGHT_JSON_OUTPUT_DIR: '',
        PLAYWRIGHT_JSON_OUTPUT_NAME: '',
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const report = JSON.parse(result.stdout) as JSONReport;
  expect(report.errors).toEqual([]);
  const specs = specsIn(report.suites);
  const files = readdirSync(path.join(root, 'evals')).filter((file) => file.endsWith('.eval.ts'));
  expect(files.length).toBeGreaterThan(0);
  expect([...new Set(specs.map((spec) => path.basename(spec.file)))].sort()).toEqual(files.sort());
  for (const spec of specs) {
    for (const test of spec.tests) {
      expect(test.expectedStatus, spec.title).toBe('passed');
      expect(
        test.annotations.filter(({ type }) => ['skip', 'fixme'].includes(type)),
        spec.title,
      ).toEqual([]);
    }
  }
});
