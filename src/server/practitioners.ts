import { z } from 'zod';
import type { Executor } from '@/db/client';
import { practitioners } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { minutesOfLocalTime } from '@/lib/time';

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const newPractitionerInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    bio: z.string().trim().max(2000).default(''),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    workdayStart: localTime,
    workdayEnd: localTime,
    active: z.boolean().default(true),
  })
  .refine(
    (p) => minutesOfLocalTime(p.workdayEnd) > minutesOfLocalTime(p.workdayStart),
    'The working day must end after it starts',
  );

export type NewPractitioner = z.input<typeof newPractitionerInput>;

export async function createPractitioner(db: Executor, clock: Clock, input: NewPractitioner): Promise<{ id: string }> {
  const practitioner = newPractitionerInput.parse(input);
  const now = clock.now();
  const id = newId(clock);
  await db.insert(practitioners).values({
    id,
    ...practitioner,
    workingDays: [...new Set(practitioner.workingDays)].sort((a, b) => a - b),
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}
