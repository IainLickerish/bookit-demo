import type { Database } from '@/db/client';
import { bookings, slots } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { createPractitioner } from '@/server/practitioners';
import { createUser } from '@/server/users';
import { TEST_PASSWORD } from './clinic';

export const ADMIN_PATIENT_NAMES = ['Zoe Bronte', 'Lukasz Wisniewski', 'Siobhan O Briain', 'Ada, "Clinic"\nTest'];

/** Fictional records on both sides of the London clock-change day's boundaries. */
export async function seedAdminBookings(db: Database, clock: Clock, prefix = 'admin-fixture') {
  const practitioner = await createPractitioner(db, clock, {
    name: 'Report Practitioner',
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    workdayStart: '00:00',
    workdayEnd: '23:59',
  });
  const starts = ['2026-10-24T22:30:00Z', '2026-10-24T23:15:00Z', '2026-10-25T23:30:00Z', '2026-10-26T00:00:00Z'];
  const ids: string[] = [];
  for (const [index, name] of ADMIN_PATIENT_NAMES.entries()) {
    const patient = await createUser(db, clock, {
      email: `${prefix}-${index}@patients.example.test`,
      name,
      role: 'patient',
      password: TEST_PASSWORD,
    });
    const slotId = newId(clock);
    const start = new Date(starts[index]!);
    await db.insert(slots).values({
      id: slotId,
      practitionerId: practitioner.id,
      startsAt: start,
      endsAt: new Date(start.getTime() + 45 * 60_000),
      createdAt: clock.now(),
    });
    const id = newId(clock);
    const cancelled = index === 2;
    await db.insert(bookings).values({
      id,
      patientId: patient.id,
      slotId,
      status: cancelled ? 'cancelled' : 'confirmed',
      lateCancellation: cancelled,
      phone: null,
      rescheduleCount: 0,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      cancelledAt: cancelled ? clock.now() : null,
    });
    ids.push(id);
  }
  return { practitionerId: practitioner.id, bookingIds: ids };
}
