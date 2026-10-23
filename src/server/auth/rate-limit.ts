import { createHash } from 'node:crypto';

export interface RateLimitRule {
  /** Attempts allowed per window. */
  limit: number;
  windowMinutes: number;
}

// Keys are hashed, so the limiter never holds an email address or IP.
function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const PRUNE_ABOVE_KEYS = 1_000;

/**
 * A sliding-window limiter held in this process's memory. BookIt runs one
 * container per tenant and environment, so a per-process limit is a
 * per-deployment limit; a restart forgets it.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly rule: RateLimitRule) {}

  private recent(hash: string, nowMs: number): number[] {
    const windowStart = nowMs - this.rule.windowMinutes * 60_000;
    const kept = (this.hits.get(hash) ?? []).filter((ms) => ms > windowStart);
    if (kept.length === 0) {
      this.hits.delete(hash);
    } else {
      this.hits.set(hash, kept);
    }
    return kept;
  }

  /** Whether another attempt for `key` is allowed now; nothing is recorded. */
  allows(key: string, now: Date): boolean {
    return this.recent(keyHash(key), now.getTime()).length < this.rule.limit;
  }

  record(key: string, now: Date): void {
    const nowMs = now.getTime();
    const hash = keyHash(key);
    this.hits.set(hash, [...this.recent(hash, nowMs), nowMs]);
    if (this.hits.size > PRUNE_ABOVE_KEYS) {
      for (const stored of [...this.hits.keys()]) {
        this.recent(stored, nowMs);
      }
    }
  }
}

/** Password reset requests: per email address and per client IP (bead supportagents-8uvs). */
export interface PasswordResetLimiter {
  perEmail: SlidingWindowLimiter;
  perIp: SlidingWindowLimiter;
}

export const RESET_REQUESTS_PER_EMAIL: RateLimitRule = { limit: 3, windowMinutes: 15 };
export const RESET_REQUESTS_PER_IP: RateLimitRule = { limit: 10, windowMinutes: 15 };

export function createPasswordResetLimiter(): PasswordResetLimiter {
  return {
    perEmail: new SlidingWindowLimiter(RESET_REQUESTS_PER_EMAIL),
    perIp: new SlidingWindowLimiter(RESET_REQUESTS_PER_IP),
  };
}

const LIMITER_KEY = Symbol.for('bookit.passwordResetLimiter');

export function getPasswordResetLimiter(): PasswordResetLimiter {
  const holder = globalThis as { [LIMITER_KEY]?: PasswordResetLimiter };
  holder[LIMITER_KEY] ??= createPasswordResetLimiter();
  return holder[LIMITER_KEY];
}
