import { EventEmitter } from 'node:events';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TestPool = EventEmitter & { end: ReturnType<typeof vi.fn<() => Promise<void>>> };
const fixture = vi.hoisted(() => {
  // These tests exercise the mocked container, regardless of the integration database environment.
  vi.stubEnv('BOOKIT_TEST_DATABASE_URL', '');
  return {
    handle: undefined as undefined | { db: object; pool: TestPool },
    stop: vi.fn<() => Promise<void>>(),
    migrate: vi.fn<() => Promise<void>>(),
  };
});

vi.mock('@testcontainers/postgresql', () => ({
  PostgreSqlContainer: class {
    withDatabase() {
      return this;
    }
    async start() {
      return { getConnectionUri: () => 'postgresql://database.example.test/bookit', stop: fixture.stop };
    }
  },
}));
vi.mock('@/db/client', () => ({ createDatabase: () => fixture.handle }));
vi.mock('@/db/migrate', () => ({ runMigrations: fixture.migrate }));

import { startTestDatabase } from '../helpers/database';

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.resetAllMocks();
  fixture.handle = { db: {}, pool: Object.assign(new EventEmitter(), { end: vi.fn(async () => undefined) }) };
});

describe('disposable database cleanup', () => {
  it('waits for every connection to close even when the pool ends first', async () => {
    const database = await startTestDatabase();
    expect(database.url).toBe('postgresql://database.example.test/bookit');
    const pool = fixture.handle!.pool;
    const first = new EventEmitter();
    const second = new EventEmitter();
    pool.emit('connect', first);
    pool.emit('connect', second);

    const stopped = database.stop();
    await Promise.resolve();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(fixture.stop).not.toHaveBeenCalled();

    first.emit('end');
    await Promise.resolve();
    expect(fixture.stop).not.toHaveBeenCalled();

    second.emit('end');
    await stopped;
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('finishes cleanup when connections have already closed or none were opened', async () => {
    const database = await startTestDatabase();
    const client = new EventEmitter();
    fixture.handle!.pool.emit('connect', client);
    client.emit('end');
    await database.stop();
    expect(fixture.stop).toHaveBeenCalledOnce();

    const unused = await startTestDatabase();
    await unused.stop();
    expect(fixture.stop).toHaveBeenCalledTimes(2);
  });

  it('reports a pool shutdown failure without stopping PostgreSQL first', async () => {
    const database = await startTestDatabase();
    fixture.handle!.pool.end.mockRejectedValueOnce(new Error('Test shutdown failure'));
    await expect(database.stop()).rejects.toThrow('Test shutdown failure');
    expect(fixture.stop).not.toHaveBeenCalled();
  });
});
