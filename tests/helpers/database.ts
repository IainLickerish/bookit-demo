import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database, type DatabaseHandle } from '@/db/client';
import { runMigrations } from '@/db/migrate';

export const POSTGRES_IMAGE = 'postgres:17-alpine';

export interface TestDatabase {
  url: string;
  db: Database;
  handle: DatabaseHandle;
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/** A migrated PostgreSQL in a throwaway container. */
export async function startTestDatabase(poolSize = 25): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('bookit').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const handle = createDatabase(url, { max: poolSize });
  return {
    url,
    db: handle.db,
    handle,
    container,
    async stop() {
      await handle.pool.end();
      await container.stop();
    },
  };
}

export async function emptyDatabase(db: Database): Promise<void> {
  await db.execute(sql`truncate table "booking", "session", "slot", "practitioner", "user", "clinic_settings"`);
}
