import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, emailHash, logFilePath } from '@/lib/logger';
import { nextRequestId } from '@/lib/request-id';
import { manualClock } from '../helpers/clock';
import { captureLogs } from '../helpers/logs';

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('bookit.requestCounter')];
});

describe('request IDs (plan 12.8)', () => {
  it('numbers requests from a per-process counter in test-clock builds', () => {
    expect([nextRequestId(true), nextRequestId(true), nextRequestId(true)]).toEqual([
      'req-000001',
      'req-000002',
      'req-000003',
    ]);
  });

  it('uses random UUIDs in other builds', () => {
    const first = nextRequestId(false);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nextRequestId(false)).not.toBe(first);
  });
});

describe('request logs (REQ-18.1-01 logging)', () => {
  it('writes JSON lines with the request ID, tenant, route and the clock time, and nothing machine-specific', () => {
    const clock = manualClock('2026-10-20T11:00:00Z');
    const logs = captureLogs(clock, 'acme');
    logs.log
      .child({ request_id: 'req-000007', route: '/bookings' })
      .info({ event: 'booking.cancelled', booking_id: 'b-1' }, 'Booking cancelled');
    expect(logs.lines).toHaveLength(1);
    const line = logs.lines[0]!;
    expect(line).toMatchObject({
      level: 'info',
      time: '2026-10-20T11:00:00.000Z',
      service: 'bookit',
      tenant: 'acme',
      environment: 'local',
      request_id: 'req-000007',
      route: '/bookings',
      event: 'booking.cancelled',
      msg: 'Booking cancelled',
    });
    expect(line).not.toHaveProperty('pid');
    expect(line).not.toHaveProperty('hostname');
  });

  it('redacts personal data passed by mistake', () => {
    const logs = captureLogs(manualClock('2026-10-20T11:00:00Z'));
    logs.log.info({
      email: 'patient1@patients.example.test',
      phone: '+44 7700 900001',
      password: 'not-a-real-password',
      user: { email: 'admin@example.test' },
    });
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain('example.test');
    expect(text).not.toContain('7700');
    expect(text).not.toContain('not-a-real-password');
    expect(logs.lines[0]).toMatchObject({ email: '[redacted]', phone: '[redacted]' });
  });
});

describe('log identity fields and the FakeLogSource file (REQ-18.1-01 logging, REQ-15.4-05)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('puts product, environment and release on every line', () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger({
      clock: () => manualClock('2026-10-20T11:00:00Z'),
      product: 'ACME',
      tenant: 'acme',
      environment: 'staging',
      release: '0123456789abcdef0123456789abcdef01234567',
      destination: { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
    });
    log.child({ request_id: 'req-000001', route: '/api/version' }).info({ event: 'http.request' });
    expect(lines[0]).toMatchObject({
      service: 'bookit',
      product: 'ACME',
      tenant: 'acme',
      environment: 'staging',
      release: '0123456789abcdef0123456789abcdef01234567',
      request_id: 'req-000001',
    });
  });

  it('writes <BOOKIT_LOG_DIR>/<product>/<environment>.jsonl as well as stdout when BOOKIT_LOG_DIR is set', () => {
    expect(logFilePath({})).toBeNull();
    expect(logFilePath({ BOOKIT_LOG_DIR: '/var/log/bookit', BOOKIT_PRODUCT: 'BEACON', BOOKIT_ENV: 'production' })).toBe(
      '/var/log/bookit/beacon/production.jsonl',
    );
    const dir = mkdtempSync(path.join(tmpdir(), 'bookit-logs-'));
    vi.stubEnv('BOOKIT_LOG_DIR', dir);
    vi.stubEnv('BOOKIT_PRODUCT', 'ACME');
    vi.stubEnv('BOOKIT_ENV', 'staging');
    const log = createLogger({ clock: () => manualClock('2026-10-20T11:00:00Z') });
    log.info({ event: 'booking.confirmed', email: 'patient1@patients.example.test' }, 'Booking confirmed');
    log.flush();
    const written = readFileSync(path.join(dir, 'acme', 'staging.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toMatchObject({
      event: 'booking.confirmed',
      product: 'ACME',
      environment: 'staging',
      email: '[redacted]',
      time: '2026-10-20T11:00:00.000Z',
    });
  });

  it('hashes email addresses to a stable reference that does not contain them', () => {
    const hash = emailHash('Patient1@Patients.Example.test ');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(emailHash('patient1@patients.example.test'));
    expect(hash).not.toBe(emailHash('patient2@patients.example.test'));
  });
});
