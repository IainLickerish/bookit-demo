import { readFileSync } from 'node:fs';
import { createDatabase } from '../src/db/client';
import { resolveClock } from '../src/lib/clock';
import { seedTenant } from '../src/server/seed/seed';
import { loadTenant } from '../src/server/seed/tenant';

try {
  const tenant = loadTenant(process.env.BOOKIT_TENANT);
  const environment = process.env.BOOKIT_ENV ?? '';
  if (process.env.BOOKIT_PRODUCT !== tenant.product) throw new Error('Product identity mismatch');
  const url = process.env.DATABASE_URL;
  const passwordFile = process.env.BOOKIT_SEED_PASSWORDS_FILE;
  if (!url || !passwordFile) throw new Error('Seed configuration missing');
  const passwords: unknown = JSON.parse(readFileSync(passwordFile, 'utf8'));
  const handle = createDatabase(url);
  try {
    const result = await seedTenant(handle.db, resolveClock(), { tenant, environment, passwords });
    console.log(JSON.stringify({ event: 'seed.completed', ...result }));
  } finally {
    await handle.pool.end();
  }
} catch {
  console.error(
    JSON.stringify({
      event: 'seed.refused',
      reason: 'Check tenant, environment, database binding, clock and password-file configuration.',
    }),
  );
  process.exitCode = 1;
}
