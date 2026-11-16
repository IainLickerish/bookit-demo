import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({ statements: [] as string[], refusals: 0 }));

vi.mock('pg', () => ({
  Client: class {
    async connect() {
      if (server.refusals > 0) {
        server.refusals--;
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:5432'), { code: 'ECONNREFUSED' });
      }
    }
    async query(statement: string) {
      server.statements.push(statement);
    }
    async end() {}
  },
}));

import { databaseOn } from '../helpers/database';

beforeEach(() => {
  server.statements = [];
  server.refusals = 0;
});

describe('a test database on a server that is already running', () => {
  it('makes a fresh database of its own, and removes it when done', async () => {
    const database = await databaseOn('postgres://postgres:made-up@sf-service:5432/postgres');
    const name = /^create database "(bookit_test_[0-9a-f]{32})"$/.exec(server.statements[0] ?? '')?.[1];
    expect(name).toBeDefined();
    expect(database.url).toBe(`postgres://postgres:made-up@sf-service:5432/${name}`);
    await database.stop();
    expect(server.statements).toEqual([`create database "${name}"`, `drop database if exists "${name}" with (force)`]);
  });

  it('waits for a server that is still starting', async () => {
    server.refusals = 1;
    await databaseOn('postgres://postgres:made-up@sf-service:5432/postgres');
    expect(server.statements).toHaveLength(1);
  });
});
