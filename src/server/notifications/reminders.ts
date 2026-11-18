import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { lockBookingChanges } from '../bookings/queries';
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

async function deliverBookingReminder(deps: ReminderDependencies, bookingId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await lockBookingChanges(tx, bookingId);
    const [booking] = await tx
      .select({ startsAt: slots.startsAt, practitionerName: practitioners.name, to: users.email })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
      .innerJoin(users, eq(users.id, bookings.patientId))
      .where(and(eq(bookings.id, bookingId), isNull(bookings.reminderAttemptedAt), dueAt(deps.clock.now())));
    if (!booking) return;

    // Check the switch after fetching the booking. Staff updates and mail
    // submission are ordered by this lock on the settings row.
    const settings = await loadClinicSettings(tx, 'share');
    if (!settings.remindersEnabled) return;

    const email = composeReminderEmail({
      ...booking,
      bookingId,
      clinicName: settings.clinicName,
      timeZone: settings.timeZone,
      from: deps.mail.from,
      tenant: deps.tenant,
      publicUrl: deps.publicUrl,
    });

    // Commit on another connection before calling SMTP, while the first
    // transaction holds both locks. A lost SMTP acknowledgement cannot
    // cause a resend, and failures in the reads above leave no attempt.
    const [attempt] = await deps.db
      .update(bookings)
      .set({ reminderAttemptedAt: deps.clock.now() })
      .where(and(eq(bookings.id, bookingId), isNull(bookings.reminderAttemptedAt)))
      .returning({ id: bookings.id });
    if (attempt) await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: bookingId });
  });
}

export async function sendDueBookingReminders(deps: ReminderDependencies): Promise<void> {
  if (deps.mail.mailer.kind === 'disabled' || !(await loadClinicSettings(deps.db)).remindersEnabled) return;

  const candidates = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(and(isNull(bookings.reminderAttemptedAt), dueAt(deps.clock.now())))
    .orderBy(asc(slots.startsAt), asc(bookings.id));

  for (const { id } of candidates) {
    await deliverBookingReminder(deps, id);
  }
}
