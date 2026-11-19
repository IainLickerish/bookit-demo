import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { bookingCancellationPath, bookingReschedulePath } from '@/lib/routes';
import { addHours, addMinutes, formatSlot } from '@/lib/time';
import { deliverEmailWithOutcome, type MailSettings } from './deliver';
import type { OutgoingEmail } from './mailer';

const LEAD_HOURS = 24;
const SEND_WINDOW_MINUTES = 30;
const UK_TIME_ZONE = 'Europe/London';

interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  publicUrl: URL;
}

function dueReminder(now: Date) {
  const latestStart = addHours(now, LEAD_HOURS);
  return and(
    eq(bookings.status, 'confirmed'),
    gt(slots.startsAt, addMinutes(latestStart, -SEND_WINDOW_MINUTES)),
    lte(slots.startsAt, latestStart),
    // For a confirmed booking, updatedAt is when its current slot was assigned.
    lte(bookings.updatedAt, sql`${slots.startsAt} - make_interval(hours => ${LEAD_HOURS})`),
  );
}

const reminderDetails = {
  startsAt: slots.startsAt,
  practitioner: practitioners.name,
  recipient: users.email,
  clinicName: clinicSettings.clinicName,
  timeZone: clinicSettings.timeZone,
};

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function composeReminder(
  id: string,
  session: { startsAt: Date; practitioner: string; recipient: string; clinicName: string; timeZone: string },
  from: string,
  publicUrl: URL,
): OutgoingEmail {
  const when = formatSlot(session.startsAt, session.timeZone);
  const isUkTime = session.timeZone === UK_TIME_ZONE;
  const timeZone = isUkTime ? 'UK time' : session.timeZone;
  const details = `Your session with ${session.practitioner} is on ${when} (${timeZone}).`;
  const ukTime = isUkTime ? '' : `UK time: ${formatSlot(session.startsAt, UK_TIME_ZONE)}.`;
  const reschedule = new URL(bookingReschedulePath(id), publicUrl);
  const cancel = new URL(bookingCancellationPath(id), publicUrl);
  const signIn = 'Sign in to manage your session.';
  const rescheduleLabel = 'Reschedule your session';
  const cancelLabel = 'Cancel your session';
  return {
    from,
    to: session.recipient,
    subject: `Session reminder for ${when}`,
    text: [
      session.clinicName,
      '',
      details,
      ...(ukTime ? [ukTime] : []),
      '',
      signIn,
      `${rescheduleLabel}: ${reschedule}`,
      `${cancelLabel}: ${cancel}`,
      '',
    ].join('\n'),
    html: [
      `<h1 style="font-family: Fraunces, Georgia, serif; font-weight: 500">${escapeHtml(session.clinicName)}</h1>`,
      `<p>${escapeHtml(details)}</p>`,
      ...(ukTime ? [`<p>${escapeHtml(ukTime)}</p>`] : []),
      `<p>${signIn}</p>`,
      `<p><a style="color: #1D5C4B" href="${escapeHtml(reschedule.href)}">${rescheduleLabel}</a></p>`,
      `<p><a style="color: #1D5C4B" href="${escapeHtml(cancel.href)}">${cancelLabel}</a></p>`,
    ].join('\n'),
  };
}

export async function sendDueReminders({ db, clock, log, mail, publicUrl }: ReminderDependencies): Promise<void> {
  if (mail.mailer.kind === 'disabled') return;

  const candidates = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
    .where(and(isNull(bookings.reminderClaimedAt), dueReminder(clock.now())))
    .orderBy(asc(slots.startsAt), asc(bookings.id));

  for (const { id } of candidates) {
    const now = clock.now();
    // Persist the claim before handing the message to the mailer. If the
    // process or connection is lost, the server may already have accepted it.
    const [claim] = await db
      .update(bookings)
      .set({ reminderClaimedAt: now })
      .from(slots)
      .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
      .where(
        and(eq(bookings.id, id), eq(bookings.slotId, slots.id), isNull(bookings.reminderClaimedAt), dueReminder(now)),
      )
      .returning({ slotId: bookings.slotId });
    if (!claim) continue;

    const claimedBooking = and(eq(bookings.id, id), eq(bookings.reminderClaimedAt, now));
    const { delivery } = await db.transaction(async (tx) => {
      // Moves and cancellations take the same row lock. The final check sees
      // changes that won the lock first, and the mailer starts under the lock.
      const [locked] = await tx.select({ id: bookings.id }).from(bookings).where(claimedBooking).for('update');
      if (!locked) return {};

      const [session] = await tx
        .select(reminderDetails)
        .from(bookings)
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
        .innerJoin(users, and(eq(users.id, bookings.patientId), eq(users.role, 'patient')))
        .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
        .where(and(eq(bookings.id, id), eq(bookings.slotId, claim.slotId), dueReminder(clock.now())))
        .for('share', { of: clinicSettings });
      if (!session) {
        await tx.update(bookings).set({ reminderClaimedAt: null }).where(claimedBooking);
        return {};
      }

      const email = composeReminder(id, session, mail.from, publicUrl);
      // Return the delivery promise in an object so the booking lock does not
      // stay held while waiting for the network.
      return { delivery: deliverEmailWithOutcome(mail, log, email, 'reminder', { booking_id: id }) };
    });
    if (delivery && (await delivery) === 'retryable') {
      await db.update(bookings).set({ reminderClaimedAt: null }).where(claimedBooking);
    }
  }
}
