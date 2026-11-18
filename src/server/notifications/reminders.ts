import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { loadClinicSettings } from '../settings';
import { deliverEmail, type MailSettings } from './deliver';
import { composeReminderEmail } from './reminder-email';

export interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  tenant: string;
  publicUrl: URL;
}

function dueAt(now: Date) {
  // Leave an hour for the recurring check to pick up newly due bookings.
  return and(
    eq(bookings.status, 'confirmed'),
    gt(slots.startsAt, addHours(now, 23)),
    lte(slots.startsAt, addHours(now, 24)),
  );
}

async function deliverClaimedReminder(deps: ReminderDependencies, bookingId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    // A move or cancellation already in progress finishes before we read the
    // slot. Once locked, the booking cannot change while we submit its email.
    const [locked] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');
    if (!locked) return;

    const settings = await loadClinicSettings(tx);
    const [booking] = settings.remindersEnabled
      ? await tx
          .select({ startsAt: slots.startsAt, practitionerName: practitioners.name, to: users.email })
          .from(bookings)
          .innerJoin(slots, eq(slots.id, bookings.slotId))
          .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
          .innerJoin(users, eq(users.id, bookings.patientId))
          .where(and(eq(bookings.id, bookingId), dueAt(deps.clock.now())))
      : [];
    if (!booking) {
      // No delivery was attempted. A move or a later switch to on can make
      // this booking eligible again.
      await tx.update(bookings).set({ reminderAttemptedAt: null }).where(eq(bookings.id, bookingId));
      return;
    }

    const email = composeReminderEmail({
      ...booking,
      bookingId,
      clinicName: settings.clinicName,
      timeZone: settings.timeZone,
      from: deps.mail.from,
      tenant: deps.tenant,
      publicUrl: deps.publicUrl,
    });
    await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: bookingId });
  });
}

export async function sendDueBookingReminders(deps: ReminderDependencies): Promise<void> {
  if (deps.mail.mailer.kind === 'disabled' || !(await loadClinicSettings(deps.db)).remindersEnabled) return;

  const candidates = await deps.db
    .select({ id: bookings.id, slotId: bookings.slotId })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(and(isNull(bookings.reminderAttemptedAt), dueAt(deps.clock.now())))
    .orderBy(asc(slots.startsAt), asc(bookings.id));

  for (const { id, slotId } of candidates) {
    // Commit the attempt before SMTP. If it accepts the message just before
    // a disconnect or process exit, a later pass must not send it again.
    const [claimed] = await deps.db
      .update(bookings)
      .set({ reminderAttemptedAt: deps.clock.now() })
      .where(
        and(
          eq(bookings.id, id),
          eq(bookings.slotId, slotId),
          eq(bookings.status, 'confirmed'),
          isNull(bookings.reminderAttemptedAt),
        ),
      )
      .returning({ id: bookings.id });
    if (claimed) await deliverClaimedReminder(deps, claimed.id);
  }
}
