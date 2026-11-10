import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { loadClinicSettings } from '../settings';
import { deliverEmail, type MailSettings } from './deliver';
import type { OutgoingEmail } from './mailer';
import { composeReminder } from './reminder';

/** How long before an appointment its reminder is due. */
export const REMINDER_LEAD_HOURS = 24;
/** How many reminders one sweep claims; the rest wait for the next sweep. */
export const REMINDER_BATCH_SIZE = 100;

export interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  /** The origin for links in the email, from BOOKIT_PUBLIC_URL. */
  publicUrl: URL;
}

export interface ReminderSweepResult {
  /** False when the clinic has switched reminders off. */
  enabled: boolean;
  /** Reminders claimed in this sweep; each is attempted once. */
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Sends the reminders that are due: for each confirmed booking whose
 * appointment starts within the next 24 hours and has had no reminder.
 *
 * - A booking gets at most one reminder. It is marked as reminded in the same
 *   transaction that selects it, with row locks that skip bookings another
 *   sweep is handling, so overlapping sweeps or servers never send twice. A
 *   failed send is logged and not retried.
 * - Cancelled bookings are never selected.
 * - A rescheduled booking is checked against its current slot, so a booking
 *   moved before its reminder went out is reminded about the new time.
 * - A booking made less than 24 hours ahead and never moved is skipped: its
 *   confirmation email, sent moments earlier, already has the details.
 * - Nothing is sent while the clinic has reminders switched off. Switching
 *   them back on sends the reminders still due for appointments that have
 *   not started.
 */
export async function sendDueReminders(deps: ReminderDependencies): Promise<ReminderSweepResult> {
  const now = deps.clock.now();
  const dueBy = addHours(now, REMINDER_LEAD_HOURS);
  const claim = await deps.db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    if (!settings.appointmentReminders) {
      return null;
    }
    const due = await tx
      .select({
        id: bookings.id,
        startsAt: slots.startsAt,
        practitionerName: practitioners.name,
        email: users.email,
        name: users.name,
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
      .innerJoin(users, eq(users.id, bookings.patientId))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          isNull(bookings.reminderSentAt),
          gt(slots.startsAt, now),
          lte(slots.startsAt, dueBy),
          or(
            gt(bookings.rescheduleCount, 0),
            lte(bookings.createdAt, sql`${slots.startsAt} - make_interval(hours => ${REMINDER_LEAD_HOURS})`),
          ),
        ),
      )
      .orderBy(asc(slots.startsAt), asc(bookings.id))
      .limit(REMINDER_BATCH_SIZE)
      .for('update', { of: bookings, skipLocked: true });
    if (due.length > 0) {
      await tx
        .update(bookings)
        .set({ reminderSentAt: now })
        .where(
          inArray(
            bookings.id,
            due.map((row) => row.id),
          ),
        );
    }
    const emails: { bookingId: string; email: OutgoingEmail }[] = due.map((row) => ({
      bookingId: row.id,
      email: composeReminder({
        booking: row,
        patient: { email: row.email, name: row.name },
        settings,
        publicUrl: deps.publicUrl,
        from: deps.mail.from,
      }),
    }));
    return emails;
  });
  if (claim === null) {
    return { enabled: false, claimed: 0, sent: 0, failed: 0 };
  }
  let sent = 0;
  for (const { bookingId, email } of claim) {
    if (await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: bookingId })) {
      sent += 1;
    }
  }
  const result = { enabled: true, claimed: claim.length, sent, failed: claim.length - sent };
  if (result.claimed > 0) {
    deps.log.info({ event: 'reminders.sweep', ...result }, 'Appointment reminders sent');
  }
  return result;
}
