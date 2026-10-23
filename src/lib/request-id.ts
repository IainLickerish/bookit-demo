import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
export const ROUTE_HEADER = 'x-bookit-route';

const COUNTER_KEY = Symbol.for('bookit.requestCounter');

/**
 * Test-clock builds number requests from a per-process counter so that log
 * lines are identical on every run; other builds use random UUIDs.
 */
export function nextRequestId(counterBased: boolean): string {
  if (!counterBased) {
    return randomUUID();
  }
  const holder = globalThis as { [COUNTER_KEY]?: number };
  const next = (holder[COUNTER_KEY] ?? 0) + 1;
  holder[COUNTER_KEY] = next;
  return `req-${String(next).padStart(6, '0')}`;
}
