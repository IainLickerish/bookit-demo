import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { sessions, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { addHours } from '@/lib/time';
import { emailInput, type PublicUser } from '../users';
import { verifyAgainstDummy, verifyPassword } from './password';

export const SESSION_COOKIE = 'bookit_session';
export const SESSION_TTL_HOURS = 12;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Checks an email and password; null when either is wrong. */
export async function authenticate(db: Executor, email: string, password: string): Promise<PublicUser | null> {
  const parsedEmail = emailInput.safeParse(email);
  const [row] = parsedEmail.success ? await db.select().from(users).where(eq(users.email, parsedEmail.data)) : [];
  if (!row) {
    await verifyAgainstDummy(password);
    return null;
  }
  if (!(await verifyPassword(password, row.passwordHash))) {
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, phone: row.phone };
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Executor, clock: Clock, userId: string): Promise<NewSession> {
  const token = randomBytes(32).toString('base64url');
  const now = clock.now();
  const expiresAt = addHours(now, SESSION_TTL_HOURS);
  await db.insert(sessions).values({
    id: newId(clock),
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/** The signed-in user for a session token, if the session has not expired. */
export async function findSessionUser(db: Executor, clock: Clock, token: string): Promise<PublicUser | null> {
  if (token.length === 0 || token.length > 128) {
    return null;
  }
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      phone: users.phone,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, clock.now())));
  return row ?? null;
}

export async function deleteSession(db: Executor, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
