import { and, eq, gt, lt } from 'drizzle-orm';
import type { Transaction } from '@/db/client';
import { practitioners, timeBlocks } from '@/db/schema';
import { BookingError } from '../bookings/errors';
import type { SlotView } from './queries';

/** Held until commit by both block creation and booking/moving, including slots generated later. */
export async function lockPractitioner(tx: Transaction, practitionerId: string) {
  const [person] = await tx
    .select({ id: practitioners.id })
    .from(practitioners)
    .where(eq(practitioners.id, practitionerId))
    .for('update');
  return person;
}

export async function assertSlotNotBlocked(tx: Transaction, slot: SlotView): Promise<void> {
  await lockPractitioner(tx, slot.practitionerId);
  const [block] = await tx
    .select({ id: timeBlocks.id })
    .from(timeBlocks)
    .where(
      and(
        eq(timeBlocks.practitionerId, slot.practitionerId),
        lt(timeBlocks.startsAt, slot.endsAt),
        gt(timeBlocks.endsAt, slot.startsAt),
      ),
    )
    .limit(1);
  if (block) throw new BookingError('slot_blocked');
}
