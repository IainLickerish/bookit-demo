import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const versionedFiles = [
  'package.json',
  'bun.lock',
  'next.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'src/server/admin/bookings.ts',
  'src/server/admin/http.ts',
  'src/server/admin/context.ts',
  'src/server/admin/settings.ts',
  'src/server/export/csv.ts',
  'src/app/admin/page.tsx',
  'src/app/admin/settings/page.tsx',
  'src/app/admin/settings/actions.ts',
  'src/app/api/admin/export/route.ts',
  'src/app/api/admin/reports/route.ts',
  'tests/helpers/admin-fixture.ts',
  'tests/helpers/admin-evidence.ts',
  'tests/unit/admin-csv.test.ts',
  'tests/integration/admin-reports.int.test.ts',
  'tests/e2e/admin.spec.ts',
];

export function adminEvidenceContext() {
  return {
    contract: 'M0-24b.admin-evidence.v1',
    ids: ['REQ-18.1-01', 'REQ-18.1-03'],
    sourceConfigFixtureSha256: Object.fromEntries(
      versionedFiles.map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
    ),
    fixture: { version: 'admin-fixture-v1', clock: '2026-10-20T07:00:00Z', timeZone: 'Europe/London', fictional: true },
    actors: ['clinic admin', 'patient', 'anonymous', 'expired session', 'foreign-clinic session'],
    endpoints: ['/admin', '/admin/settings', '/api/admin/export', '/api/admin/reports'],
    notApplicable: {
      supportagentsRecords:
        'No SupportAgents intake, case, Change, action, policy, model, provider or data-access records in this BookIt-only feature.',
      connectorCallsAndAuditOrdering:
        'The feature reads or updates its own disposable clinic database; it invokes no SupportAgents connector or audit chain.',
      networkDenials:
        'Cross-clinic isolation is proven with two separate databases and refused sessions/selectors; SupportAgents egress-denial tests belong to its runtime beads.',
    },
    securityRecord: 'M0-24b admin access, current-role, foreign-session, tenant-selector and log-redaction assertions',
  };
}

/** Withhold the complete log if a canary is found; retain only its count, never its value. */
export function adminLogEvidence(lines: readonly Record<string, unknown>[], forbidden: readonly string[]) {
  const text = JSON.stringify(lines);
  const matches = forbidden.filter((value) => value !== '' && text.includes(value)).length;
  return {
    redaction: { passed: matches === 0, forbiddenValueCount: matches, checkedValueCount: forbidden.length },
    adminEvents: matches === 0 ? lines.filter((line) => String(line.event).startsWith('admin.')) : [],
  };
}
