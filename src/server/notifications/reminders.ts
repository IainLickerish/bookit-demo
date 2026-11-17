import { and, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Database, Executor } from '@/db/client';
import { bookingReminders, bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours, addMinutes } from '@/lib/time';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import { deliverEmail, type MailSettings } from './deliver';
import { composeReminder, type ReminderInput } from './reminder';

export const REMINDER_LEAD_HOURS = 24;
export const REMINDER_WINDOW_MINUTES = 5;

export interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  publicUrl: URL;
  words: ReminderInput['words'];
}

function dueBookings(db: Executor, now: Date, bookingId?: string) {
  const latestStart = addHours(now, REMINDER_LEAD_HOURS);
  return db
    .select({
      id: bookings.id,
      startsAt: slots.startsAt,
      practitionerName: practitioners.name,
      name: users.name,
      email: users.email,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .leftJoin(bookingReminders, eq(bookingReminders.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, 'confirmed'),
        eq(users.role, 'patient'),
        gte(slots.startsAt, addMinutes(latestStart, -REMINDER_WINDOW_MINUTES)),
        lte(slots.startsAt, latestStart),
        gt(slots.startsAt, now),
        lte(bookings.createdAt, sql`${slots.startsAt} - interval '24 hours'`),
        isNull(bookingReminders.bookingId),
        bookingId ? eq(bookings.id, bookingId) : undefined,
      ),
    );
}

/** Claims are committed before SMTP, so even an interrupted dispatch cannot be claimed again. */
export async function sendDueReminders(deps: ReminderDependencies, bookingId?: string): Promise<number> {
  if (deps.mail.mailer.kind === 'disabled') return 0;
  const now = deps.clock.now();
  try {
    const claimed = await deps.db.transaction(async (tx) => {
      const settings = await loadClinicSettings(tx);
      if (!settings.remindersEnabled) return [];
      const due = await dueBookings(tx, now, bookingId)
        .orderBy(slots.startsAt, bookings.id)
        .limit(100)
        .for('update', { of: bookings, skipLocked: true });
      if (due.length === 0) return [];
      const claims = await tx
        .insert(bookingReminders)
        .values(due.map((booking) => ({ bookingId: booking.id, attemptedAt: now })))
        .onConflictDoNothing()
        .returning({ id: bookingReminders.bookingId });
      return claims.map(({ id }) => {
        const booking = due.find((candidate) => candidate.id === id)!;
        return {
          id,
          email: composeReminder({
            clinic: settings,
            patient: booking,
            booking,
            from: deps.mail.from,
            words: deps.words,
            publicUrl: deps.publicUrl,
          }),
        };
      });
    });
    // SMTP runs after the claim commits, without holding up booking changes.
    for (const { id, email } of claimed) {
      await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: id });
    }
    return claimed.length;
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
