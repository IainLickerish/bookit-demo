import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database, Executor } from '@/db/client';
import { passwordResetTokens, sessions, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { emailHash, type Logger } from '@/lib/logger';
import { resetPasswordPath } from '@/lib/routes';
import { addMinutes } from '@/lib/time';
import type { OutgoingEmail } from '../notifications/mailer';
import { composePasswordResetEmail } from '../notifications/password-reset-email';
import { loadClinicSettings } from '../settings';
import { emailInput } from '../users';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password';
import type { PasswordResetLimiter } from './rate-limit';

export const RESET_TOKEN_TTL_MINUTES = 30;

const MAX_TOKEN_LENGTH = 128;

/**
 * The stored form of a token: sha256 over the tenant and the token, so the
 * token is never stored and a token issued for one tenant cannot match a row
 * written for another, even in a shared database.
 */
function tokenHash(tenant: string, token: string): string {
  return createHash('sha256').update(`${tenant}:${token}`).digest('hex');
}

export interface PasswordResetDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  /** BOOKIT_TENANT of this container. */
  tenant: string;
}

export interface ResetRequestDependencies extends PasswordResetDependencies {
  limiter: PasswordResetLimiter;
  /** BOOKIT_PUBLIC_URL; never the request's Host header. */
  publicUrl: URL;
  mailFrom: string;
}

export type ResetRequestOutcome = 'issued' | 'unknown_email' | 'invalid_email' | 'rate_limited';

export interface ResetRequestResult {
  outcome: ResetRequestOutcome;
  /** The email to send; only when a token was issued. */
  email: OutgoingEmail | null;
}

/**
 * Handles a forgot-password request. The caller shows the same neutral
 * message for every outcome, so the response never reveals whether an
 * account exists. A new token replaces any earlier unused one.
 */
export async function requestPasswordReset(
  deps: ResetRequestDependencies,
  request: { email: string; clientIp: string },
): Promise<ResetRequestResult> {
  const now = deps.clock.now();
  const parsed = emailInput.safeParse(request.email);
  const finish = (outcome: ResetRequestOutcome, email: OutgoingEmail | null = null): ResetRequestResult => {
    deps.log.info(
      {
        event: 'auth.password_reset.requested',
        outcome,
        ...(parsed.success ? { email_hash: emailHash(parsed.data) } : {}),
      },
      'Password reset requested',
    );
    return { outcome, email };
  };
  if (!parsed.success) {
    return finish('invalid_email');
  }
  const emailKey = `email:${parsed.data}`;
  const ipKey = `ip:${request.clientIp}`;
  if (!deps.limiter.perEmail.allows(emailKey, now) || !deps.limiter.perIp.allows(ipKey, now)) {
    return finish('rate_limited');
  }
  deps.limiter.perEmail.record(emailKey, now);
  deps.limiter.perIp.record(ipKey, now);

  const [user] = await deps.db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, parsed.data));
  if (!user) {
    return finish('unknown_email');
  }
  const settings = await loadClinicSettings(deps.db);
  const token = randomBytes(32).toString('base64url');
  await deps.db.transaction(async (tx) => {
    await supersedeUnusedTokens(tx, user.id, now);
    await tx.insert(passwordResetTokens).values({
      id: newId(deps.clock),
      userId: user.id,
      tenant: deps.tenant,
      tokenHash: tokenHash(deps.tenant, token),
      createdAt: now,
      expiresAt: addMinutes(now, RESET_TOKEN_TTL_MINUTES),
      usedAt: null,
    });
  });
  const email = composePasswordResetEmail({
    to: user.email,
    name: user.name,
    clinicName: settings.clinicName,
    link: new URL(resetPasswordPath(token), deps.publicUrl).toString(),
    validMinutes: RESET_TOKEN_TTL_MINUTES,
    from: deps.mailFrom,
  });
  return finish('issued', email);
}

async function supersedeUnusedTokens(db: Executor, userId: string, now: Date): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
}

function plausibleToken(token: string): boolean {
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH;
}

function usableToken(tenant: string, token: string, now: Date) {
  return and(
    eq(passwordResetTokens.tokenHash, tokenHash(tenant, token)),
    eq(passwordResetTokens.tenant, tenant),
    isNull(passwordResetTokens.usedAt),
    gt(passwordResetTokens.expiresAt, now),
  );
}

/** Whether a token can still be used; reading it does not use it. */
export async function isResetTokenUsable(deps: PasswordResetDependencies, token: string): Promise<boolean> {
  if (!plausibleToken(token)) {
    return false;
  }
  const [row] = await deps.db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(usableToken(deps.tenant, token, deps.clock.now()));
  return row !== undefined;
}

export type ResetOutcome = 'reset' | 'invalid_token' | 'weak_password' | 'mismatch';

/**
 * Sets a new password with a reset token. The token is used up atomically,
 * so two requests with one token cannot both succeed; every session of the
 * user is ended and any other outstanding token is cancelled.
 */
export async function completePasswordReset(
  deps: PasswordResetDependencies,
  request: { token: string; password: string; confirmation: string },
): Promise<ResetOutcome> {
  if (request.password !== request.confirmation) {
    return 'mismatch';
  }
  if (request.password.length < MIN_PASSWORD_LENGTH || request.password.length > MAX_PASSWORD_LENGTH) {
    return 'weak_password';
  }
  // Checked first so an unknown token costs no password hashing.
  if (!(await isResetTokenUsable(deps, request.token))) {
    deps.log.info({ event: 'auth.password_reset.refused', reason: 'invalid_token' }, 'Password reset refused');
    return 'invalid_token';
  }
  const passwordHash = await hashPassword(request.password);
  const now = deps.clock.now();
  const result = await deps.db.transaction(async (tx) => {
    const [used] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(usableToken(deps.tenant, request.token, now))
      .returning({ userId: passwordResetTokens.userId });
    if (!used) {
      return null;
    }
    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, used.userId));
    const ended = await tx.delete(sessions).where(eq(sessions.userId, used.userId)).returning({ id: sessions.id });
    await supersedeUnusedTokens(tx, used.userId, now);
    return { userId: used.userId, sessionsEnded: ended.length };
  });
  if (!result) {
    deps.log.info({ event: 'auth.password_reset.refused', reason: 'invalid_token' }, 'Password reset refused');
    return 'invalid_token';
  }
  deps.log.info(
    { event: 'auth.password_reset.completed', user_id: result.userId, sessions_ended: result.sessionsEnded },
    'Password reset',
  );
  return 'reset';
}
