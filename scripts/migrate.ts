import { runMigrations } from '../src/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
await runMigrations(url);
console.log(JSON.stringify({ event: 'db.migrated' }));
