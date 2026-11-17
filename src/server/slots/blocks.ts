import { and, eq, gt, lt } from 'drizzle-orm';
import type { Transaction } from '@/db/client';
import { practitionerBlocks, practitioners } from '@/db/schema';
import { BookingError } from '../bookings/errors';
import type { SlotView } from './queries';

/** Shared by saving a block, booking and moving. The lock lasts until commit. */
export async function lockPractitioner(tx: Transaction, practitionerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: practitioners.id })
    .from(practitioners)
    .where(eq(practitioners.id, practitionerId))
    .for('update');
  return row !== undefined;
}

export async function assertSlotNotBlocked(tx: Transaction, slot: SlotView): Promise<void> {
  await lockPractitioner(tx, slot.practitionerId);
  // A separate statement after the lock sees blocks committed while we waited.
  // Preserve the existing refusal for an already booked slot.
  const [block] = await tx
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
  if (block) throw new BookingError('slot_blocked');
}
