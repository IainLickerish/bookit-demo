import { randomBytes } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadTenant } from '../src/server/seed/tenant';

try {
  const tenant = loadTenant(process.argv[2]);
  const target = path.resolve(process.argv[3] ?? `test-results/local/${tenant.tenant}`);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if ((statSync(target).mode & 0o077) !== 0) throw new Error('Credential directory must be private');
  // Rootless Compose retains host ownership. The private directory protects
  // read-only files on the host while each container can read its own mount.
  // Exclusive creation prevents a restart from silently rotating the database or account passwords.
  writeFileSync(path.join(target, 'database-password'), randomBytes(32).toString('hex'), { mode: 0o444, flag: 'wx' });
  writeFileSync(path.join(target, 'postgres-password'), randomBytes(32).toString('hex'), { mode: 0o444, flag: 'wx' });
  const passwords = Object.fromEntries(
    tenant.accounts.map((account) => [account.email, randomBytes(24).toString('base64url')]),
  );
  writeFileSync(path.join(target, 'accounts.json'), JSON.stringify(passwords), { mode: 0o444, flag: 'wx' });
  console.log(
    `Created local test credential files in ${target}. Values are never printed; read them privately when signing in.`,
  );
} catch {
  console.error(
    'Credential creation refused. Select acme or beacon and a fresh private directory; existing files are never replaced.',
  );
  process.exitCode = 1;
}
