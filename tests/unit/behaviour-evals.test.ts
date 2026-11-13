import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { JSONReport, JSONReportSpec, JSONReportSuite } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

// Keep the owner's agreed wording here so a missing or renamed check fails discovery.
const lateCancellationCriteria = [
  'In both clinics, cancelling an upcoming booking inside the configured late window moves it from Upcoming to Past and cancelled with “Cancelled (late)”; the top success notice agrees and the result remains after reloading.',
  'The same clinic’s staff see that booking as “Cancelled (late)”, included under the Cancelled filter and excluded from Confirmed.',
  'Another client is offered the released time and can book it; if two clients try together, only one receives a confirmed booking.',
  'Cancelling exactly at the late-window boundary or earlier still shows “Cancelled” to client and staff, gives the ordinary success notice and releases the time. Check both clinic defaults and a changed clinic window.',
  'A booking that has started cannot be cancelled, and an already cancelled booking cannot be cancelled again. Refusals explain what happened and provide a way onward; a failed save shows a problem instead of cancellation success and leaves the booking confirmed and its time unavailable.',
  'Clients can view and cancel only their own bookings in their own clinic. Signed-out visitors and other clients cannot cancel them; clients cannot open clinic-wide bookings, exports or settings.',
  'Existing bookings remain unchanged until a permitted action changes them, and an existing upcoming confirmed booking can now be cancelled late. If it was the client’s last upcoming booking, My bookings shows the cancelled booking and a useful way to book another time.',
  'All existing owner key flows pass unchanged, including booking and confirmation emails, moves, private bookings, simultaneous bookings, optional phone numbers, UK times through clock changes, sign-in, password recovery and staff tools.',
];

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
  expect(
    specs.filter((spec) => path.basename(spec.file) === '10-late-cancellation.eval.ts').map((spec) => spec.title),
  ).toEqual(lateCancellationCriteria);
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
