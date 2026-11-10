import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { blockedTimePage, listBlockedTime } from '@/server/admin/blocked-time';

function databaseWithRows(results: unknown[][][]) {
  const query = vi.fn<(config: { text: string }, values: unknown[]) => Promise<{ rows: unknown[][] }>>(async () => ({
    rows: results.shift() ?? [],
  }));
  const db = drizzle({ client: { query } as unknown as Pool, schema });
  return { db, query };
}

const period = (id: string) => [id, 'Alex', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', null];
const booking = (blockId: string, id: string) => [
  blockId,
  id,
  'Patient',
  'patient@example.test',
  null,
  '2026-10-01T09:00:00Z',
];

describe('blocked period pagination', () => {
  it('loads only one page and fetches all its warnings in one query', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `period-${i}`);
    const { db, query } = databaseWithRows([
      ids.map(period),
      [booking(ids[0]!, 'booking-a'), booking(ids[0]!, 'booking-b'), booking(ids[19]!, 'booking-a')],
    ]);
    const result = await listBlockedTime(db, 2);
    expect(result.hasMore).toBe(true);
    expect(result.rows.map((row) => row.id)).toEqual(ids.slice(0, 20));
    expect(result.rows[0]!.bookings.map((row) => row.id)).toEqual(['booking-a', 'booking-b']);
    expect(result.rows[1]!.bookings).toEqual([]);
    expect(result.rows[19]!.bookings.map((row) => row.id)).toEqual(['booking-a']);
    expect(query).toHaveBeenCalledTimes(2);
    const [periodQuery, warningQuery] = query.mock.calls;
    expect(periodQuery![0].text).toContain('order by "blocked_period"."created_at" desc, "blocked_period"."id" desc');
    expect(periodQuery![0].text).toContain('limit $1 offset $2');
    expect(periodQuery![1]).toEqual([21, 20]);
    expect(warningQuery![1]).toEqual(['confirmed', ...ids.slice(0, 20)]);
    expect(warningQuery![0].text).toContain('"blocked_period"."id" in (');
    expect(warningQuery![0].text).toContain('"slot"."starts_at" < "blocked_period"."ends_at"');
    expect(warningQuery![0].text).toContain('"slot"."ends_at" > "blocked_period"."starts_at"');
  });

  it('keeps a final partial page accessible and stops offering more pages', async () => {
    const { db, query } = databaseWithRows([[period('older')], []]);
    const result = await listBlockedTime(db, 3);
    expect(result.rows.map((row) => row.id)).toEqual(['older']);
    expect(result.hasMore).toBe(false);
    expect(query.mock.calls[0]![1]).toEqual([21, 40]);
  });

  it('does not query bookings when there are no periods on a page', async () => {
    const { db, query } = databaseWithRows([[]]);
    expect(await listBlockedTime(db)).toEqual({ rows: [], hasMore: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', '0', '-1', '1.5', 'abc', '1e2', ['2'], '9999999999999999999'])(
    'uses page one for an invalid page: %j',
    (value) => {
      expect(blockedTimePage(value)).toBe(1);
    },
  );

  it('accepts a valid page number', () => {
    expect(blockedTimePage('3')).toBe(3);
  });
});
