import { eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { clinicSettings } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { clinicSettingsInput, ClinicNotConfiguredError } from '@/server/settings';

export const adminSettingsInput = clinicSettingsInput
  .pick({
    clinicName: true,
    timeZone: true,
    lateCancellationHours: true,
    includeContactInConfirmation: true,
  })
  .strict();

/** Update only the four admin-editable fields; preserve the booking rules. */
export async function updateAdminSettings(db: Executor, clock: Clock, input: unknown): Promise<void> {
  const values = adminSettingsInput.parse(input);
  const changed = await db
    .update(clinicSettings)
    .set({ ...values, updatedAt: clock.now() })
    .where(eq(clinicSettings.id, 1))
    .returning({ id: clinicSettings.id });
  if (changed.length !== 1) throw new ClinicNotConfiguredError();
}
