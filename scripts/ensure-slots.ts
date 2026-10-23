import { createDatabase } from '../src/db/client';
import { resolveClock } from '../src/lib/clock';
import { ensureSlotsThroughHorizon } from '../src/server/slots/ensure';

// Scripts are not built by Next.js, so the build flag comes from the
// environment: test-clock images set BOOKIT_BUILD_ALLOW_TEST_CLOCK=true.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const { db, pool } = createDatabase(url, { max: 1 });
try {
  const created = await ensureSlotsThroughHorizon(db, resolveClock());
  console.log(JSON.stringify({ event: 'slots.ensured', created }));
} finally {
  await pool.end();
}
