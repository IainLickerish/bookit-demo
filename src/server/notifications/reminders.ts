import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
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
  return and(gte(slots.startsAt, addHours(now, 23)), lte(slots.startsAt, addHours(now, 24)));
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
      // Reserve the attempt durably before contacting SMTP. A mail server can accept it and still report a failure.
      const [reserved] = await db
        .update(bookings)
        .set({ reminderAttemptedAt: clock.now() })
        .where(and(eq(bookings.id, id), awaitingReminder))
        .returning({ id: bookings.id });
      if (!reserved) continue;

      await db.transaction(async (tx) => {
        const settings = await loadClinicSettings(tx, 'share');
        const [locked] = await tx
          .select({ slotId: bookings.slotId, patientId: bookings.patientId, status: bookings.status })
          .from(bookings)
          .where(eq(bookings.id, id))
          .for('update');
        if (!locked) return;

        if (settings.sendBookingReminders && locked.status === 'confirmed') {
          const [details] = await tx
            .select({ startsAt: slots.startsAt, practitionerName: practitioners.name, to: users.email })
            .from(slots)
            .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
            .innerJoin(users, and(eq(users.id, locked.patientId), eq(users.role, 'patient')))
            .where(and(eq(slots.id, locked.slotId), startsWithinReminderWindow(clock.now())));
          if (details) {
            const email = composeReminderEmail({ bookingId: id, publicUrl, from: mail.from, ...settings, ...details });
            // Keep booking and settings changes ordered with the SMTP acceptance or failure.
            await deliverEmail(mail, log, email, 'reminder', { booking_id: id });
            return;
          }
        }

        // A move or settings change can make the booking eligible on a later poll.
        await tx.update(bookings).set({ reminderAttemptedAt: null }).where(eq(bookings.id, id));
      });
    }
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
