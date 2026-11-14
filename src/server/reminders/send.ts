import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database, Transaction } from '@/db/client';
import { bookingReminders, bookings, clinicSettings, practitioners, slots, users } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import type { Logger } from '@/lib/logger';
import { addHours } from '@/lib/time';
import { withoutQueryDetails } from '@/server/errors';
import { reportError } from '@/server/error-reporting';
import { deliverEmail, type MailSettings } from '@/server/notifications/deliver';
import { assertTestAddress, EmailAddressRefusedError } from '@/server/notifications/mailer';
import { composeReminder } from '@/server/notifications/reminder';
import type { TenantName } from '@/server/seed/tenant';
import { clinicSettingsInput, ClinicNotConfiguredError } from '@/server/settings';

export interface ReminderDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
  tenant: TenantName;
  publicUrl: URL;
}

export function reminderIsDue(startsAt: Date, now: Date): boolean {
  return startsAt > now && startsAt <= addHours(now, 24);
}

async function lockedSettings(tx: Transaction) {
  const [row] = await tx.select().from(clinicSettings).where(eq(clinicSettings.id, 1)).for('share');
  if (!row) throw new ClinicNotConfiguredError();
  return clinicSettingsInput.parse(row);
}

async function lockedBooking(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      id: bookings.id,
      slotId: bookings.slotId,
      status: bookings.status,
      startsAt: slots.startsAt,
      practitionerName: practitioners.name,
      email: users.email,
      name: users.name,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(practitioners, eq(practitioners.id, slots.practitionerId))
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(and(eq(bookings.id, id), eq(users.role, 'patient')))
    .for('update', { of: bookings });
  return row;
}

function allowedAddress(deps: ReminderDependencies, email: string, bookingId: string): boolean {
  try {
    assertTestAddress(deps.mail.from, 'sender');
    assertTestAddress(email, 'recipient');
    return true;
  } catch (error) {
    if (!(error instanceof EmailAddressRefusedError)) throw error;
    deps.log.warn({ event: 'reminder.address_refused', booking_id: bookingId }, 'Reminder address refused');
    return false;
  }
}

async function sendForBooking(deps: ReminderDependencies, id: string): Promise<boolean> {
  // Commit before contacting SMTP. A process lost after this commit leaves an
  // unconfirmed reservation, which no worker may automatically retry.
  const reservation = await deps.db.transaction(async (tx) => {
    const settings = await lockedSettings(tx);
    if (!settings.remindersEnabled) return null;
    const booking = await lockedBooking(tx, id);
    const now = deps.clock.now();
    if (
      !booking ||
      booking.status !== 'confirmed' ||
      !reminderIsDue(booking.startsAt, now) ||
      !allowedAddress(deps, booking.email, id)
    )
      return null;
    const [saved] = await tx
      .insert(bookingReminders)
      .values({
        bookingId: id,
        slotId: booking.slotId,
        startsAt: booking.startsAt,
        reservedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    return saved ?? null;
  });
  if (!reservation) return false;

  return deps.db.transaction(async (tx) => {
    const settings = await lockedSettings(tx);
    const booking = await lockedBooking(tx, id);
    // Keep both locks until SMTP finishes: moves, cancellations and switching
    // reminders off are ordered before or after sending, never through it.
    if (
      !settings.remindersEnabled ||
      !booking ||
      booking.status !== 'confirmed' ||
      booking.slotId !== reservation.slotId ||
      booking.startsAt.getTime() !== reservation.startsAt.getTime() ||
      !reminderIsDue(booking.startsAt, deps.clock.now()) ||
      !allowedAddress(deps, booking.email, id)
    ) {
      // This invocation knows it has not contacted SMTP. Only its own fresh
      // reservation can be released; pre-existing unconfirmed history is never removed.
      await tx
        .delete(bookingReminders)
        .where(
          and(
            eq(bookingReminders.bookingId, id),
            eq(bookingReminders.reservedAt, reservation.reservedAt),
            isNull(bookingReminders.sentAt),
          ),
        );
      return false;
    }
    const email = composeReminder({
      clinicName: settings.clinicName,
      tenant: deps.tenant,
      patient: { email: booking.email, name: booking.name },
      booking,
      from: deps.mail.from,
      publicUrl: deps.publicUrl,
    });
    const confirmed = await deliverEmail(deps.mail, deps.log, email, 'reminder', { booking_id: id });
    if (confirmed) {
      await tx.update(bookingReminders).set({ sentAt: deps.clock.now() }).where(eq(bookingReminders.bookingId, id));
    }
    return confirmed;
  });
}

/** One bounded pass. Every booking is rechecked under locks using the shared clock. */
export async function sendDueReminders(deps: ReminderDependencies): Promise<number> {
  if (deps.mail.mailer.kind === 'disabled') return 0;
  try {
    const now = deps.clock.now();
    const candidates = await deps.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .leftJoin(bookingReminders, eq(bookingReminders.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          gt(slots.startsAt, now),
          lte(slots.startsAt, addHours(now, 24)),
          isNull(bookingReminders.bookingId),
        ),
      )
      .orderBy(asc(slots.startsAt), asc(bookings.id))
      .limit(50);
    let sent = 0;
    for (const booking of candidates) {
      try {
        if (await sendForBooking(deps, booking.id)) sent++;
      } catch (error) {
        // A durable reservation may already exist. Never remove it after an
        // unexpected failure: SMTP acceptance or a commit result may be uncertain.
        const safe = withoutQueryDetails(error);
        deps.log.error(
          {
            event: 'reminder.unconfirmed',
            booking_id: booking.id,
            error_name: safe instanceof Error ? safe.name : 'unknown',
          },
          'Reminder outcome could not be confirmed',
        );
        reportError(safe, { operation: 'reminder' });
      }
    }
    return sent;
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
