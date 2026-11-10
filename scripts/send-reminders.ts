import { createDatabase } from '../src/db/client';
import { resolveClock } from '../src/lib/clock';
import { getLogger } from '../src/lib/logger';
import { publicBaseUrl } from '../src/lib/runtime-identity';
import { mailSettings } from '../src/server/notifications/deliver';
import { sendDueReminders } from '../src/server/notifications/reminders';

// Sends the appointment reminders that are due now, once. The server already
// does this every few minutes; this is for operators and tests. Running it
// alongside the server is safe: a booking is never reminded twice.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const { db, pool } = createDatabase(url, { max: 1 });
try {
  const result = await sendDueReminders({
    db,
    clock: resolveClock(),
    log: getLogger(),
    mail: mailSettings(),
    publicUrl: publicBaseUrl(),
  });
  console.log(JSON.stringify({ event: 'reminders.sent', ...result }));
} finally {
  await pool.end();
}
