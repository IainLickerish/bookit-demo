import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookingReminderAttempts, bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import type { Logger } from '@/lib/logger';
import { bookingCancellationPath, bookingReschedulePath } from '@/lib/routes';
import { addHours, addMinutes, formatSlot } from '@/lib/time';
import { deliverEmailWithOutcome, type MailSettings } from './deliver';
import type { OutgoingEmail } from './mailer';

const LEAD_HOURS = 24;
const SEND_WINDOW_MINUTES = 30;
const UK_TIME_ZONE = 'Europe/London';
const pendingReleases = new WeakMap<Database, Set<string>>();

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
  const timeZone = session.timeZone === UK_TIME_ZONE ? 'UK time' : session.timeZone;
  const details = `Your session with ${session.practitioner} is on ${when} (${timeZone}).`;
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
      '',
      signIn,
      `${rescheduleLabel}: ${reschedule}`,
      `${cancelLabel}: ${cancel}`,
      '',
    ].join('\n'),
    html: [
      `<h1 style="font-family: Fraunces, Georgia, serif; font-weight: 500">${escapeHtml(session.clinicName)}</h1>`,
      `<p>${escapeHtml(details)}</p>`,
      `<p>${signIn}</p>`,
      `<p><a style="color: #1D5C4B" href="${escapeHtml(reschedule.href)}">${rescheduleLabel}</a></p>`,
      `<p><a style="color: #1D5C4B" href="${escapeHtml(cancel.href)}">${cancelLabel}</a></p>`,
    ].join('\n'),
  };
}

async function releaseUnacceptedAttempts(db: Database, releases: Set<string>): Promise<void> {
  if (releases.size === 0) return;
  const ids = [...releases];
  await db.delete(bookingReminderAttempts).where(inArray(bookingReminderAttempts.id, ids));
  ids.forEach((id) => releases.delete(id));
}

export async function sendDueReminders({ db, clock, log, mail, publicUrl }: ReminderDependencies): Promise<void> {
  if (mail.mailer.kind === 'disabled') return;

  const releases = pendingReleases.get(db) ?? new Set<string>();
  pendingReleases.set(db, releases);
  // A database outage may interrupt cleanup after a confirmed failure.
  // Retry deleting only those specific attempts, never another worker's.
  await releaseUnacceptedAttempts(db, releases);

  const candidates = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
    .leftJoin(bookingReminderAttempts, eq(bookingReminderAttempts.bookingId, bookings.id))
    .where(and(isNull(bookingReminderAttempts.id), dueReminder(clock.now())))
    .orderBy(asc(slots.startsAt), asc(bookings.id));

  for (const { id } of candidates) {
    let releaseAttemptId: string | undefined;
    try {
      await db.transaction(async (tx) => {
        // This lock is the only reservation until the final checks succeed.
        // It blocks moves and cancellations while allowing the attempt's FK check.
        const [locked] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(eq(bookings.id, id))
          .for('no key update');
        if (!locked) return;

        const [session] = await tx
          .select(reminderDetails)
          .from(bookings)
          .innerJoin(slots, eq(slots.id, bookings.slotId))
          .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
          .innerJoin(users, and(eq(users.id, bookings.patientId), eq(users.role, 'patient')))
          .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
          .leftJoin(bookingReminderAttempts, eq(bookingReminderAttempts.bookingId, bookings.id))
          .where(and(eq(bookings.id, id), isNull(bookingReminderAttempts.id), dueReminder(clock.now())))
          .for('share', { of: clinicSettings });
        if (!session) return;

        const email = composeReminder(id, session, mail.from, publicUrl);
        const attemptId = newId(clock);
        releaseAttemptId = attemptId;
        // Commit the attempt on a separate connection right before SMTP.
        // The booking and settings stay locked even if acceptance is uncertain.
        const [attempt] = await db
          .insert(bookingReminderAttempts)
          .values({ id: attemptId, bookingId: id, attemptedAt: clock.now() })
          .onConflictDoNothing({ target: bookingReminderAttempts.bookingId })
          .returning({ id: bookingReminderAttempts.id });
        releaseAttemptId = undefined;
        if (!attempt) return;

        const outcome = await deliverEmailWithOutcome(mail, log, email, 'reminder', { booking_id: id });
        if (outcome === 'retryable') releaseAttemptId = attemptId;
      });
    } finally {
      if (releaseAttemptId) {
        releases.add(releaseAttemptId);
        await releaseUnacceptedAttempts(db, releases);
      }
    }
  }
}
