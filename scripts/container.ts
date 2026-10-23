import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDatabase } from '../src/db/client';
import { assertSeedIdentity } from '../src/server/seed/seed';
import { loadTenant } from '../src/server/seed/tenant';

try {
  const tenant = loadTenant(process.env.BOOKIT_TENANT);
  if (process.env.BOOKIT_PRODUCT !== tenant.product || process.env.BOOKIT_MAIL_FROM !== tenant.mailFrom) {
    throw new Error('Container identity mismatch');
  }
  const secretFile = process.env.BOOKIT_DB_PASSWORD_FILE;
  if (!secretFile) throw new Error('Database secret file missing');
  const secret = readFileSync(secretFile, 'utf8').trim();
  if (secret.length < 12) throw new Error('Database secret invalid');
  const url = new URL('postgresql://bookit@db:5432/bookit');
  url.hostname = process.env.BOOKIT_DB_HOST ?? 'db';
  url.password = secret;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString() };
  const command = process.argv[2] ?? 'server';
  if (command === 'server') {
    const handle = createDatabase(url.toString());
    try {
      await assertSeedIdentity(handle.db, tenant.tenant, process.env.BOOKIT_ENV ?? '');
    } finally {
      await handle.pool.end();
    }
  }
  if (command === 'seed') {
    env.BOOKIT_BUILD_ALLOW_TEST_CLOCK = readFileSync('/app/seed-clock-build-flag', 'utf8').trim();
  }
  const args =
    command === 'migrate'
      ? ['scripts/migrate.ts']
      : command === 'seed'
        ? ['scripts/seed.ts']
        : command === 'server'
          ? ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0']
          : null;
  if (!args) throw new Error('Unknown container command');
  const child = spawn(command === 'server' ? 'node' : 'bun', args, { env, stdio: 'inherit' });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
  child.on('error', () => {
    console.error('BookIt container process could not start.');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  console.error('BookIt container configuration refused; check identity and secret-file configuration.');
  process.exitCode = 1;
}
