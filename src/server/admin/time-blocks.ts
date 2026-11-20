import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/db/client';
import { practitionerTimeBlocks } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { lockPractitionerSchedule } from '../practitioners';
import { loadClinicSettings } from '../settings';
import { listAffectedBookings } from './bookings';
import { parseTimeBlock, type TimeBlockFields } from './time-block-input';

const reviewInput = z.object({ id: z.uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });
export type TimeBlockConfirmation = z.infer<typeof reviewInput>;

/** The admin action authenticates the caller before reaching this service. */
export async function submitTimeBlock(db: Database, clock: Clock, fields: TimeBlockFields, confirmation?: unknown) {
  const reviewed = reviewInput.safeParse(confirmation).data;
  return db.transaction(async (tx) => {
    const { timeZone } = await loadClinicSettings(tx);
    const parsed = parseTimeBlock(fields, timeZone);
    if (parsed.status !== 'valid') return parsed;
    const { block } = parsed;
    const practitioner = await lockPractitionerSchedule(tx, block.practitionerId, reviewed ? 'no key update' : 'share');
    if (!practitioner?.active) return { status: 'invalid_practitioner' } as const;

    if (reviewed) {
      const [saved] = await tx.select().from(practitionerTimeBlocks).where(eq(practitionerTimeBlocks.id, reviewed.id));
      if (
        saved?.practitionerId === block.practitionerId &&
        saved.startsAt.getTime() === block.startsAt.getTime() &&
        saved.endsAt.getTime() === block.endsAt.getTime() &&
        saved.reason === block.reason
      ) {
        return { status: 'saved', id: saved.id } as const;
      }
    }

    const bookings = await listAffectedBookings(tx, block);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([block, timeZone, practitioner.name, bookings]))
      .digest('hex');
    if (reviewed?.fingerprint === fingerprint) {
      const [saved] = await tx
        .insert(practitionerTimeBlocks)
        .values({ id: reviewed.id, ...block, createdAt: clock.now() })
        .onConflictDoNothing({ target: practitionerTimeBlocks.id })
        .returning({ id: practitionerTimeBlocks.id });
      if (saved) return { status: 'saved', id: saved.id } as const;
    }

    return {
      status: 'review',
      changed: reviewed !== undefined,
      confirmation: { id: newId(clock), fingerprint },
      block,
      timeZone,
      practitionerName: practitioner.name,
      bookings,
    } as const;
  });
}
