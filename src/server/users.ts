import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth/password';
import { phoneInput } from './bookings/rules';

export type UserRole = 'patient' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
}

export const emailInput = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const newUserInput = z.object({
  email: emailInput,
  name: z.string().trim().min(1).max(120),
  role: z.enum(['patient', 'admin']),
  phone: phoneInput,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export type NewUser = z.input<typeof newUserInput>;

export async function createUser(db: Executor, clock: Clock, input: NewUser): Promise<PublicUser> {
  const user = newUserInput.parse(input);
  const now = clock.now();
  const id = newId(clock);
  await db.insert(users).values({
    id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    passwordHash: await hashPassword(user.password),
    createdAt: now,
    updatedAt: now,
  });
  return { id, email: user.email, name: user.name, role: user.role, phone: user.phone };
}

export async function findUserById(db: Executor, id: string): Promise<PublicUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      phone: users.phone,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}
