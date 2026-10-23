import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { clinicSettings } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { isValidTimeZone } from '@/lib/time';

export const clinicSettingsInput = z.object({
  clinicName: z.string().trim().min(1).max(120),
  timeZone: z.string().refine(isValidTimeZone, 'Unknown IANA time zone'),
  lateCancellationHours: z.number().int().min(0).max(336),
  includeContactInConfirmation: z.boolean(),
  slotHorizonDays: z.number().int().min(1).max(366),
  sessionMinutes: z.number().int().min(5).max(480),
  maxReschedulesPerBooking: z.number().int().min(0).max(20),
});

export type ClinicSettings = z.infer<typeof clinicSettingsInput>;

const SETTINGS_ROW_ID = 1;

export class ClinicNotConfiguredError extends Error {
  override readonly name = 'ClinicNotConfiguredError';
  constructor() {
    super('The clinic_settings row is missing. Seed the clinic before starting BookIt.');
  }
}

export async function loadClinicSettings(db: Executor): Promise<ClinicSettings> {
  const [row] = await db.select().from(clinicSettings).where(eq(clinicSettings.id, SETTINGS_ROW_ID));
  if (!row) {
    throw new ClinicNotConfiguredError();
  }
  return clinicSettingsInput.parse({
    clinicName: row.clinicName,
    timeZone: row.timeZone,
    lateCancellationHours: row.lateCancellationHours,
    includeContactInConfirmation: row.includeContactInConfirmation,
    slotHorizonDays: row.slotHorizonDays,
    sessionMinutes: row.sessionMinutes,
    maxReschedulesPerBooking: row.maxReschedulesPerBooking,
  });
}

export async function saveClinicSettings(db: Executor, clock: Clock, input: ClinicSettings): Promise<ClinicSettings> {
  const settings = clinicSettingsInput.parse(input);
  const values = { ...settings, updatedAt: clock.now() };
  await db
    .insert(clinicSettings)
    .values({ id: SETTINGS_ROW_ID, ...values })
    .onConflictDoUpdate({ target: clinicSettings.id, set: values });
  return settings;
}
