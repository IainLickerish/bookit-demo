import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function tenantEvidenceDirectory(layer: string): string {
  const dir = path.resolve('test-results/m0-24d', `${layer}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeTenantEvidence(directory: string, results: unknown, logs: string, canaries: readonly string[]) {
  const files = [
    'Dockerfile',
    'compose.yml',
    '.dockerignore',
    'package.json',
    'bun.lock',
    'next.config.ts',
    'src/lib/clock.ts',
    'src/lib/build-flags.ts',
    'src/lib/build-identity.ts',
    'src/server/startup.ts',
    'tenants/acme.json',
    'tenants/beacon.json',
    'scripts/seed.ts',
    'scripts/container.ts',
    'scripts/init-database.sh',
    'scripts/start-database.sh',
    'scripts/local-proxy.mjs',
    'scripts/local-credentials.ts',
    'src/server/seed/tenant.ts',
    'src/server/seed/seed.ts',
    'tests/helpers/compose.ts',
    'tests/helpers/compose-receiver.mjs',
    'tests/helpers/tenant-evidence.ts',
    'tests/unit/tenants.test.ts',
    'tests/integration/seed.int.test.ts',
    'tests/e2e/tenants.spec.ts',
    ...['acme', 'beacon'].flatMap((tenant) =>
      readdirSync(`docs/user-guide/${tenant}`).map((file) => `docs/user-guide/${tenant}/${file}`),
    ),
  ];
  const hits = canaries.filter((canary) => canary.length > 0 && logs.includes(canary)).length;
  const evidence = {
    contract: 'M0-24d.tenant-evidence.v1',
    ids: ['REQ-18.1-03', 'REQ-18.1-06', 'REQ-18.2-01'],
    sourceConfigFixtureSha256: Object.fromEntries(
      files.map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
    ),
    results,
    redaction: { passed: hits === 0, checked: canaries.length, matches: hits },
    logs: hits === 0 ? logs : '[withheld: canary detected]',
    actors: ['local seed caller', 'Acme admin/patient', 'Beacon admin/patient', 'foreign session'],
    endpoints: ['/api/health', '/api/version', '/admin', '/api/admin/export', '/auth/sign-in', '/bookings'],
    securityRecord: 'M0-24d: separate database roles/networks, seed binding and foreign session/query denial',
    notApplicable: {
      supportagents:
        'This fictional product has no SupportAgents intake/case/Change/action/policy/model/provider/data-access records or audit chain. Runtime control proofs remain with M0-26a/b/d and the named security beads.',
      connectors:
        'No SupportAgents connectors are invoked. BookIt SMTP and SDK protocol receivers are local test fixtures.',
    },
  };
  writeFileSync(path.join(directory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (hits > 0) throw new Error('Tenant evidence withheld because a sensitive canary was found');
}
