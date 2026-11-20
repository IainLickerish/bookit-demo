import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { createDatabase, type Database, type DatabaseHandle } from '@/db/client';
import { runMigrations } from '@/db/migrate';

export const POSTGRES_IMAGE = 'postgres:17-alpine';

export interface TestDatabase {
  url: string;
  db: Database;
  handle: DatabaseHandle;
  stop(): Promise<void>;
}

/**
 * A PostgreSQL server that is already running, given by its address with a user that may create databases. The
 * Software Factory runs one beside its sealed build runs, which cannot start containers (see factory.yml). Without it,
 * each test database is a throwaway container, as in CI.
 */
const RUNNING_SERVER = process.env.BOOKIT_TEST_DATABASE_URL;

/** A migrated PostgreSQL of its own for one test file: a throwaway container, or a fresh database on a running server. */
export async function startTestDatabase(poolSize = 25): Promise<TestDatabase> {
  const server = RUNNING_SERVER ? await databaseOn(RUNNING_SERVER) : await databaseInContainer();
  const url = server.url;
  await runMigrations(url);
  const handle = createDatabase(url, { max: poolSize });
  // Pool.end() can resolve before its idle clients have finished disconnecting.
  // Wait for their end events before stopping PostgreSQL underneath them.
  const connectionsClosing = new Set<Promise<void>>();
  handle.pool.on('connect', (client) => {
    const closed = new Promise<void>((resolve) => client.once('end', resolve));
    connectionsClosing.add(closed);
    void closed.then(() => connectionsClosing.delete(closed));
  });
  return {
    url,
    db: handle.db,
    handle,
    async stop() {
      await handle.pool.end();
      await Promise.all(connectionsClosing);
      await server.stop();
    },
  };
}

async function databaseInContainer(): Promise<{ url: string; stop(): Promise<void> }> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('bookit').start();
  return { url: container.getConnectionUri(), stop: async () => void (await container.stop()) };
}

/** A fresh, empty database on a running server, removed again when the test file is done. */
export async function databaseOn(serverUrl: string): Promise<{ url: string; stop(): Promise<void> }> {
  const name = `bookit_test_${randomUUID().replaceAll('-', '')}`;
  await onServer(serverUrl, `create database "${name}"`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), stop: () => onServer(serverUrl, `drop database if exists "${name}" with (force)`) };
}

/** Runs one statement on the server, waiting up to 30 seconds for it to accept connections, as it may be starting. */
async function onServer(serverUrl: string, statement: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ connectionString: serverUrl });
    try {
      await client.connect();
      await client.query(statement);
      return;
    } catch (error) {
      if (attempt >= 30 || !isStarting(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

const isStarting = (error: unknown): boolean =>
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|starting up|57P03/.test(
    `${(error as { code?: string }).code ?? ''} ${String(error)}`,
  );

export async function emptyDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table "booking", "session", "password_reset_token", "slot", "time_block", "practitioner", "user", "clinic_settings"`,
  );
}
