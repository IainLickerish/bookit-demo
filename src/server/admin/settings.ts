import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { bookings, clinicSettings, slots } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { clinicSettingsInput, ClinicNotConfiguredError } from '@/server/settings';
import { withoutQueryDetails } from '../errors';

export const adminSettingsInput = clinicSettingsInput
  .pick({
    clinicName: true,
    timeZone: true,
    lateCancellationHours: true,
    includeContactInConfirmation: true,
    remindersEnabled: true,
  })
  // Older callers leave the reminder choice alone; the staff form always supplies it.
  .extend({ remindersEnabled: z.boolean().optional() })
  .strict();

/** Update only the admin-editable fields; preserve the booking rules. */
export async function updateAdminSettings(db: Executor, clock: Clock, input: unknown): Promise<void> {
  const values = adminSettingsInput.parse(input);
  try {
    await db.transaction(async (tx) => {
      // The worker holds this row for share through delivery. Lock it first,
      // then record skips before making the off-to-on transition visible.
      const [before] = await tx.select().from(clinicSettings).where(eq(clinicSettings.id, 1)).for('update');
      if (!before) throw new ClinicNotConfiguredError();
      const now = clock.now();
      if (!before.remindersEnabled && values.remindersEnabled === true) {
        await tx
          .update(bookings)
          .set({ reminderSkippedAt: now })
          .where(
            and(
              eq(bookings.status, 'confirmed'),
              isNull(bookings.reminderAttemptedAt),
              isNull(bookings.reminderSkippedAt),
              inArray(
                bookings.slotId,
                tx
                  .select({ id: slots.id })
                  .from(slots)
                  .where(
                    and(gt(slots.startsAt, now), lte(slots.startsAt, new Date(now.getTime() + 24 * 60 * 60 * 1000))),
                  ),
              ),
            ),
          );
      }
      await tx
        .update(clinicSettings)
        .set({ ...values, updatedAt: now })
        .where(eq(clinicSettings.id, 1));
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
