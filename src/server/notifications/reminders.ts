import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import { deliverEmail, type MailSettings } from './deliver';
import { composeReminderEmail } from './reminder-email';

interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  publicUrl: URL;
}

const awaitingReminder = and(eq(bookings.status, 'confirmed'), isNull(bookings.reminderAttemptedAt));

function startsWithinReminderWindow(now: Date) {
  return and(gt(slots.startsAt, now), lte(slots.startsAt, addHours(now, 24)));
}

export async function sendDueBookingReminders(deps: ReminderDependencies): Promise<void> {
  const { db, clock, log, mail, publicUrl } = deps;
  if (mail.mailer.kind === 'disabled') return;

  try {
    if (!(await loadClinicSettings(db)).sendBookingReminders) return;
    const candidates = await db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .where(and(awaitingReminder, startsWithinReminderWindow(clock.now())))
      .orderBy(asc(slots.startsAt), asc(bookings.id));

    for (const { id } of candidates) {
      const email = await db.transaction(async (tx) => {
        const settings = await loadClinicSettings(tx, 'share');
        if (!settings.sendBookingReminders) return null;

        const [locked] = await tx
          .select({ slotId: bookings.slotId, patientId: bookings.patientId })
          .from(bookings)
          .where(and(eq(bookings.id, id), awaitingReminder))
          .for('update', { skipLocked: true });
        if (!locked) return null;

        // Recheck the current slot under the same booking lock used by moves and cancellations.
        const now = clock.now();
        const [details] = await tx
          .select({ startsAt: slots.startsAt, practitionerName: practitioners.name, to: users.email })
          .from(slots)
          .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
          .innerJoin(users, and(eq(users.id, locked.patientId), eq(users.role, 'patient')))
          .where(and(eq(slots.id, locked.slotId), startsWithinReminderWindow(now)));
        if (!details) return null;

        const message = composeReminderEmail({ bookingId: id, publicUrl, from: mail.from, ...settings, ...details });
        // Commit the attempt before handing off to SMTP. SMTP can accept a message and still report a failure.
        await tx.update(bookings).set({ reminderAttemptedAt: now }).where(eq(bookings.id, id));
        return message;
      });
      if (email) await deliverEmail(mail, log, email, 'reminder', { booking_id: id });
    }
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
