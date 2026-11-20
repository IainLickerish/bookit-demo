import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { deliverEmail, type MailSettings } from './deliver';
import { composeReminder } from './reminder-email';

interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  publicUrl: URL;
}

const REMINDER_HOURS = 24;
const REMINDERS_PER_RUN = 100;

/** Dispatch each due booking at most once, including across workers and restarts. */
export async function sendDueReminders({ db, clock, log, mail, publicUrl }: ReminderDependencies): Promise<void> {
  if (mail.mailer.kind === 'disabled') return;
  for (let index = 0; index < REMINDERS_PER_RUN; index++) {
    const now = clock.now();
    const dispatch = await db.transaction(async (tx) => {
      const [due] = await tx
        .select({
          bookingId: bookings.id,
          startsAt: slots.startsAt,
          clinicName: clinicSettings.clinicName,
          practitionerName: practitioners.name,
          patientName: users.name,
          patientEmail: users.email,
        })
        .from(bookings)
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
        .innerJoin(users, eq(users.id, bookings.patientId))
        .innerJoin(clinicSettings, eq(clinicSettings.remindersEnabled, true))
        .where(
          and(
            eq(bookings.status, 'confirmed'),
            isNull(bookings.reminderAttemptedAt),
            gt(slots.startsAt, now),
            lte(slots.startsAt, addHours(now, REMINDER_HOURS)),
          ),
        )
        .orderBy(asc(slots.startsAt), asc(bookings.id))
        .limit(1)
        .for('update', { of: [bookings, clinicSettings], skipLocked: true });
      if (!due) return null;

      const email = composeReminder({ ...due, from: mail.from, publicUrl });
      // Commit dispatch before calling SMTP. A disconnect can mean SMTP already
      // accepted the message, so retrying a recorded attempt could email twice.
      await tx.update(bookings).set({ reminderAttemptedAt: now }).where(eq(bookings.id, due.bookingId));
      return { bookingId: due.bookingId, email };
    });
    if (!dispatch) return;
    await deliverEmail(mail, log, dispatch.email, 'reminder', { booking_id: dispatch.bookingId });
  }
}
