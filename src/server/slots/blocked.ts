import { and, eq, gt, lt } from 'drizzle-orm';
import type { Transaction } from '@/db/client';
import { practitionerBlocks, practitioners } from '@/db/schema';
import { BookingError } from '../bookings/errors';
import type { SlotView } from './queries';

/** Shared lock order for booking, moving and blocking. Hold until the write commits. */
export async function lockPractitioner(tx: Transaction, practitionerId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: practitioners.id })
    .from(practitioners)
    .where(eq(practitioners.id, practitionerId))
    .for('update');
  return rows.length === 1;
}

export async function assertSlotNotBlocked(tx: Transaction, slot: SlotView): Promise<void> {
  await lockPractitioner(tx, slot.practitionerId);
  // Read after taking the lock, so a block committed while waiting is visible.
  const [blocked] = await tx
    .select({ id: practitionerBlocks.id })
    .from(practitionerBlocks)
    .where(
      and(
        eq(practitionerBlocks.practitionerId, slot.practitionerId),
        lt(practitionerBlocks.startsAt, slot.endsAt),
        gt(practitionerBlocks.endsAt, slot.startsAt),
      ),
    )
    .limit(1);
  if (blocked) throw new BookingError('slot_blocked');
}
