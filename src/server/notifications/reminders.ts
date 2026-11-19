import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { bookingCancellationPath, bookingReschedulePath } from '@/lib/routes';
import { addHours, formatSlot } from '@/lib/time';
import { deliverEmail, type MailSettings } from './deliver';

interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  publicUrl: URL;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function dueReminder(now: Date) {
  return and(
    eq(bookings.status, 'confirmed'),
    isNull(bookings.reminderClaimedAt),
    gt(slots.startsAt, now),
    lte(slots.startsAt, addHours(now, 24)),
  );
}

export async function sendDueReminders({ db, clock, log, mail, publicUrl }: ReminderDependencies): Promise<void> {
  if (mail.mailer.kind === 'disabled') return;

  const candidates = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
    .where(dueReminder(clock.now()))
    .orderBy(asc(slots.startsAt), asc(bookings.id));

  for (const { id } of candidates) {
    const now = clock.now();
    // Claim one at a time and recheck the current slot, status and setting.
    // Commit before SMTP: a delivery failure may follow acceptance, so a
    // claimed reminder is never retried, even after a process restart.
    const [reminder] = await db
      .update(bookings)
      .set({ reminderClaimedAt: now })
      .from(slots)
      .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
      .innerJoin(users, eq(users.role, 'patient'))
      .innerJoin(clinicSettings, eq(clinicSettings.reminderEmailsEnabled, true))
      .where(
        and(eq(bookings.id, id), eq(bookings.slotId, slots.id), eq(bookings.patientId, users.id), dueReminder(now)),
      )
      .returning({
        startsAt: slots.startsAt,
        practitioner: practitioners.name,
        recipient: users.email,
        clinicName: clinicSettings.clinicName,
      });
    if (!reminder) continue;

    const when = formatSlot(reminder.startsAt, 'Europe/London');
    const reschedule = new URL(bookingReschedulePath(id), publicUrl);
    const cancel = new URL(bookingCancellationPath(id), publicUrl);
    const details = `Your session with ${reminder.practitioner} is on ${when} (UK time).`;
    const signIn = 'Sign in to manage your session.';
    const rescheduleLabel = 'Reschedule your session';
    const cancelLabel = 'Cancel your session';
    await deliverEmail(
      mail,
      log,
      {
        from: mail.from,
        to: reminder.recipient,
        subject: `Session reminder for ${when}`,
        text: [
          reminder.clinicName,
          '',
          details,
          '',
          signIn,
          `${rescheduleLabel}: ${reschedule}`,
          `${cancelLabel}: ${cancel}`,
          '',
        ].join('\n'),
        html: [
          `<h1 style="font-family: Fraunces, Georgia, serif; font-weight: 500">${escapeHtml(reminder.clinicName)}</h1>`,
          `<p>${escapeHtml(details)}</p>`,
          `<p>${signIn}</p>`,
          `<p><a style="color: #1D5C4B" href="${escapeHtml(reschedule.href)}">${rescheduleLabel}</a></p>`,
          `<p><a style="color: #1D5C4B" href="${escapeHtml(cancel.href)}">${cancelLabel}</a></p>`,
        ].join('\n'),
      },
      'reminder',
      { booking_id: id },
    );
  }
}
