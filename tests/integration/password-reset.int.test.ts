import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { passwordResetTokens, sessions } from '@/db/schema';
import { authenticate, createSession, findSessionUser } from '@/server/auth/session';
import {
  completePasswordReset,
  isResetTokenUsable,
  requestPasswordReset,
  RESET_TOKEN_TTL_MINUTES,
  type ResetRequestDependencies,
} from '@/server/auth/password-reset';
import { createPasswordResetLimiter } from '@/server/auth/rate-limit';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { emptyDatabase, startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs, type CapturedLogs } from '../helpers/logs';
import { TEST_MAIL_FROM } from '../helpers/mail';

const EVIDENCE_DIR = path.resolve(import.meta.dirname, '../../test-results/8uvs');
const NEW_PASSWORD = 'a-new-test-only-password';
const PUBLIC_URL = new URL('https://acme-staging.example.test');

let database: TestDatabase;
let clinic: SeededClinic;
let logs: CapturedLogs;
const clock = manualClock('2026-10-20T07:00:00Z');

function deps(tenant = 'acme', limiter = createPasswordResetLimiter()): ResetRequestDependencies {
  return { db: database.db, clock, log: logs.log, tenant, limiter, publicUrl: PUBLIC_URL, mailFrom: TEST_MAIL_FROM };
}

/** Requests a reset and returns the token from the emailed link. */
async function issueToken(email: string, d = deps()): Promise<string> {
  const result = await requestPasswordReset(d, { email, clientIp: '192.0.2.10' });
  expect(result.outcome).toBe('issued');
  const link = /https:\/\/acme-staging\.example\.test\/auth\/reset-password\/([A-Za-z0-9_-]+)/.exec(
    result.email?.text ?? '',
  );
  expect(link).not.toBeNull();
  return link![1]!;
}

function complete(token: string, d = deps(), password = NEW_PASSWORD) {
  return completePasswordReset(d, { token, password, confirmation: password });
}

function recordEvidence(name: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(data)}`);
}

beforeAll(async () => {
  database = await startTestDatabase(10);
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  clock.set('2026-10-20T07:00:00Z');
  await emptyDatabase(database.db);
  clinic = await seedClinic(database.db, clock);
  logs = captureLogs(clock);
});

describe('requesting a reset (bead supportagents-8uvs: enumeration-safe, link only in the email)', () => {
  it('emails a single-use link for a known account and stores only a hash of the token', async () => {
    const result = await requestPasswordReset(deps(), {
      email: ` ${clinic.patient1.email.toUpperCase()} `,
      clientIp: '192.0.2.10',
    });
    expect(result.outcome).toBe('issued');
    expect(result.email).toMatchObject({ from: TEST_MAIL_FROM, to: clinic.patient1.email });
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(result.email!.text)![1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await database.db.select().from(passwordResetTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: clinic.patient1.id, tenant: 'acme', usedAt: null });
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime()).toBe(RESET_TOKEN_TTL_MINUTES * 60_000);
    expect(JSON.stringify(logs.lines)).not.toContain(token);
    expect(JSON.stringify(logs.lines)).not.toContain('patients.example.test');
  });

  it('gives an unknown or malformed address no email and the same kind of result, without storing anything', async () => {
    for (const email of ['nobody@patients.example.test', 'not an email']) {
      const result = await requestPasswordReset(deps(), { email, clientIp: '192.0.2.10' });
      expect(result.email).toBeNull();
      expect(['unknown_email', 'invalid_email']).toContain(result.outcome);
    }
    expect(await database.db.select().from(passwordResetTokens)).toHaveLength(0);
    recordEvidence('enumeration-safe-request', {
      known: (await requestPasswordReset(deps(), { email: clinic.patient2.email, clientIp: '192.0.2.10' })).outcome,
      unknown: (await requestPasswordReset(deps(), { email: 'nobody@patients.example.test', clientIp: '192.0.2.10' }))
        .outcome,
      note: 'The action redirects every outcome to /auth/forgot-password?sent=1 and sends the email after the response.',
    });
  });

  it('a new request replaces the earlier unused token', async () => {
    const first = await issueToken(clinic.patient1.email);
    const second = await issueToken(clinic.patient1.email);
    expect(await isResetTokenUsable(deps(), first)).toBe(false);
    expect(await isResetTokenUsable(deps(), second)).toBe(true);
  });

  it('limits requests per email address and per client IP', async () => {
    const d = deps();
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(
        (await requestPasswordReset(d, { email: clinic.patient1.email, clientIp: `192.0.2.${i}` })).outcome,
      );
    }
    expect(outcomes).toEqual(['issued', 'issued', 'issued', 'rate_limited']);
    const fromOneIp: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      fromOneIp.push(
        (await requestPasswordReset(d, { email: `nobody${i}@patients.example.test`, clientIp: '198.51.100.7' }))
          .outcome,
      );
    }
    expect(fromOneIp.slice(0, 10).every((o) => o === 'unknown_email')).toBe(true);
    expect(fromOneIp[10]).toBe('rate_limited');
    clock.advanceMinutes(16);
    expect((await requestPasswordReset(d, { email: clinic.patient1.email, clientIp: '192.0.2.99' })).outcome).toBe(
      'issued',
    );
    recordEvidence('rate-limits', { perEmail: outcomes, perIpEleventh: fromOneIp[10], afterWindow: 'issued' });
  });
});

describe('completing a reset (bead supportagents-8uvs: expiry, reuse, sessions, tenant isolation)', () => {
  it('sets the new password, ends every session of the user and uses the token up', async () => {
    const before = await createSession(database.db, clock, clinic.patient1.id);
    const other = await createSession(database.db, clock, clinic.patient2.id);
    const token = await issueToken(clinic.patient1.email);
    expect(await complete(token)).toBe('reset');
    expect(await authenticate(database.db, clinic.patient1.email, NEW_PASSWORD)).toMatchObject({
      id: clinic.patient1.id,
    });
    expect(await authenticate(database.db, clinic.patient1.email, TEST_PASSWORD)).toBeNull();
    expect(await findSessionUser(database.db, clock, before.token)).toBeNull();
    expect(await findSessionUser(database.db, clock, other.token)).toMatchObject({ id: clinic.patient2.id });
    expect(await database.db.select().from(sessions).where(eq(sessions.userId, clinic.patient1.id))).toHaveLength(0);
    expect(await complete(token)).toBe('invalid_token');
    expect(logs.lines.find((l) => l.event === 'auth.password_reset.completed')).toMatchObject({ sessions_ended: 1 });
    expect(JSON.stringify(logs.lines)).not.toContain(token);
    recordEvidence('reset-lifecycle', {
      firstUse: 'reset',
      reuse: 'invalid_token',
      newPasswordWorks: true,
      oldPasswordRefused: true,
      sessionsEndedForUser: 1,
      otherUsersSessionKept: true,
    });
  });

  it('refuses an expired token', async () => {
    const token = await issueToken(clinic.patient1.email);
    clock.advanceMinutes(RESET_TOKEN_TTL_MINUTES);
    expect(await isResetTokenUsable(deps(), token)).toBe(false);
    expect(await complete(token)).toBe('invalid_token');
    expect(await authenticate(database.db, clinic.patient1.email, TEST_PASSWORD)).not.toBeNull();
  });

  it('refuses unknown, empty and oversized tokens', async () => {
    for (const token of ['', 'x'.repeat(200), 'Q2hvb3NlIGEgbmV3IHBhc3N3b3JkIGZvciBCb29rSXQ']) {
      expect(await complete(token)).toBe('invalid_token');
    }
  });

  it('a token issued by one tenant never works for another', async () => {
    const token = await issueToken(clinic.patient1.email, deps('acme'));
    expect(await isResetTokenUsable(deps('beacon'), token)).toBe(false);
    expect(await complete(token, deps('beacon'))).toBe('invalid_token');
    expect(await isResetTokenUsable(deps('acme'), token)).toBe(true);
    recordEvidence('tenant-isolation', { issuedBy: 'acme', usedByBeacon: 'invalid_token', stillUsableByAcme: true });
  });

  it('checks the new password before using the token', async () => {
    const token = await issueToken(clinic.patient1.email);
    expect(await completePasswordReset(deps(), { token, password: 'short', confirmation: 'short' })).toBe(
      'weak_password',
    );
    expect(
      await completePasswordReset(deps(), { token, password: NEW_PASSWORD, confirmation: `${NEW_PASSWORD}x` }),
    ).toBe('mismatch');
    expect(await isResetTokenUsable(deps(), token)).toBe(true);
  });

  it('two resets with the same token at once: exactly one succeeds', async () => {
    const token = await issueToken(clinic.patient1.email);
    const outcomes = await Promise.all([
      complete(token, deps(), `${NEW_PASSWORD}-1`),
      complete(token, deps(), `${NEW_PASSWORD}-2`),
    ]);
    expect(outcomes.sort()).toEqual(['invalid_token', 'reset']);
    recordEvidence('concurrent-reset-same-token', { outcomes });
  });
});
