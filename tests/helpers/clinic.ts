import type { Database } from '@/db/client';
import { users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { hashPassword } from '@/server/auth/password';
import { createPractitioner } from '@/server/practitioners';
import { saveClinicSettings, type ClinicSettings } from '@/server/settings';
import { ensureSlotsThroughHorizon } from '@/server/slots/ensure';
import { createUser, type PublicUser } from '@/server/users';

/** Shared by every seeded test account; the database is a throwaway container. */
export const TEST_PASSWORD = 'test-only-password-for-bookit';

export const TEST_CLINIC_SETTINGS: ClinicSettings = {
  clinicName: 'Test Physio Clinic',
  timeZone: 'Europe/London',
  lateCancellationHours: 24,
  // The optional-contact regression with collection enabled is owned by the
  // external DEF-04 fixture; ordinary booking tests exercise collection off.
  includeContactInConfirmation: false,
  slotHorizonDays: 220,
  sessionMinutes: 45,
  maxReschedulesPerBooking: 3,
};

export interface SeededClinic {
  settings: ClinicSettings;
  practitioners: { weekdays: string; saturdays: string };
  patient1: PublicUser;
  patient2: PublicUser;
  admin: PublicUser;
  /** Extra patients for concurrency tests; they share TEST_PASSWORD. */
  extraPatientIds: string[];
  slotsCreated: number;
}

export interface SeedOptions {
  settings?: Partial<ClinicSettings>;
  extraPatients?: number;
}

export async function seedClinic(db: Database, clock: Clock, options: SeedOptions = {}): Promise<SeededClinic> {
  const settings = await saveClinicSettings(db, clock, {
    ...TEST_CLINIC_SETTINGS,
    ...options.settings,
  });
  const weekdays = await createPractitioner(db, clock, {
    name: 'Pat Physio',
    bio: 'Physiotherapist',
    workingDays: [1, 2, 3, 4, 5],
    workdayStart: '09:00',
    workdayEnd: '17:00',
  });
  const saturdays = await createPractitioner(db, clock, {
    name: 'Sam Sports',
    bio: 'Sports injuries',
    workingDays: [2, 4, 6],
    workdayStart: '10:00',
    workdayEnd: '16:00',
  });
  const patient1 = await createUser(db, clock, {
    email: 'patient1@patients.example.test',
    name: 'Patient One',
    role: 'patient',
    phone: '+44 7700 900001',
    password: TEST_PASSWORD,
  });
  const patient2 = await createUser(db, clock, {
    email: 'patient2@patients.example.test',
    name: 'Patient Two',
    role: 'patient',
    phone: null,
    password: TEST_PASSWORD,
  });
  const admin = await createUser(db, clock, {
    email: 'admin@example.test',
    name: 'Clinic Admin',
    role: 'admin',
    password: TEST_PASSWORD,
  });
  const extraPatientIds: string[] = [];
  const count = options.extraPatients ?? 0;
  if (count > 0) {
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const now = clock.now();
    const rows = Array.from({ length: count }, (_, i) => ({
      id: newId(clock),
      email: `extra${i + 1}@patients.example.test`,
      name: `Extra Patient ${i + 1}`,
      role: 'patient' as const,
      phone: null,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(users).values(rows);
    extraPatientIds.push(...rows.map((row) => row.id));
  }
  const slotsCreated = await ensureSlotsThroughHorizon(db, clock);
  return {
    settings,
    practitioners: { weekdays: weekdays.id, saturdays: saturdays.id },
    patient1,
    patient2,
    admin,
    extraPatientIds,
    slotsCreated,
  };
}
