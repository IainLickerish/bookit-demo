import { and, gt, lt, type SQLWrapper } from 'drizzle-orm';
import { slots } from '@/db/schema';

/** Two intervals overlap only when they share time, not when they touch at an endpoint. */
export function slotOverlaps(startsAt: Date | SQLWrapper, endsAt: Date | SQLWrapper) {
  return and(lt(slots.startsAt, endsAt), gt(slots.endsAt, startsAt));
}
