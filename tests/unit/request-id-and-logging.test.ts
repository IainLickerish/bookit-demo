import { beforeEach, describe, expect, it } from 'vitest';
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
