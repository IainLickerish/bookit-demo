import { sql } from 'drizzle-orm';
import type { Transaction } from '@/db/client';

/**
 * Serialise diary writes within this clinic's database. Take this before row
 * locks, and read availability afterwards, so a block cannot race a book or move.
 * Separate tenant databases have independent advisory locks.
 */
export async function lockDiary(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(781204)`);
}
