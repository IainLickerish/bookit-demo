import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything queries can run on: the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
}

export function createDatabase(
  connectionString: string,
  poolConfig: Omit<PoolConfig, 'connectionString'> = {},
): DatabaseHandle {
  const pool = new Pool({ connectionString, max: 10, ...poolConfig });
  return { db: drizzle(pool, { schema }), pool };
}

const DATABASE_KEY = Symbol.for('bookit.database');

export function getDatabase(): Database {
  const holder = globalThis as { [DATABASE_KEY]?: DatabaseHandle };
  if (!holder[DATABASE_KEY]) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set.');
    }
    holder[DATABASE_KEY] = createDatabase(url);
  }
  return holder[DATABASE_KEY].db;
}
