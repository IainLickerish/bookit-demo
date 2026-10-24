import { eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { practitioners, slots } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { loadClinicSettings } from '../settings';
import { generateSlotTimes } from './generate';

const INSERT_BATCH_SIZE = 500;

/**
 * Creates any missing slots for every active practitioner from now up to the
 * booking horizon. Existing slots are left alone, so it is safe to run again.
 * Returns the number of slots created.
 */
export async function ensureSlotsThroughHorizon(db: Executor, clock: Clock): Promise<number> {
  const settings = await loadClinicSettings(db);
  const now = clock.now();
  const active = await db.select().from(practitioners).where(eq(practitioners.active, true));
  let created = 0;
  for (const practitioner of active) {
    const times = generateSlotTimes(
      {
        workingDays: practitioner.workingDays,
        workdayStart: practitioner.workdayStart,
        workdayEnd: practitioner.workdayEnd,
        sessionMinutes: settings.sessionMinutes,
        timeZone: settings.timeZone,
      },
      now,
      settings.slotHorizonDays,
    );
    for (let i = 0; i < times.length; i += INSERT_BATCH_SIZE) {
      const batch = times.slice(i, i + INSERT_BATCH_SIZE).map((t) => ({
        id: newId(clock),
        practitionerId: practitioner.id,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        createdAt: now,
      }));
      const inserted = await db
        .insert(slots)
        .values(batch)
        .onConflictDoNothing({ target: [slots.practitionerId, slots.startsAt] })
        .returning({ id: slots.id });
      created += inserted.length;
    }
  }
  return created;
}
