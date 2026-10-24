import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Timestamps are always written from the application clock (src/lib/clock.ts),
// never from SQL now(), so test-clock builds follow the shared virtual clock.
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userRole = pgEnum('user_role', ['patient', 'admin']);
export const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled']);

export const users = pgTable(
  'user',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [uniqueIndex('user_email_key').on(t.email), check('user_email_lowercase', sql`"email" = lower("email")`)],
);

export const sessions = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: instant('created_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
  },
  (t) => [uniqueIndex('session_token_hash_key').on(t.tokenHash), index('session_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_token',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The tenant that issued the token; a token never works for another tenant. */
    tenant: text('tenant').notNull(),
    /** sha256 of the tenant and the token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: instant('created_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
    /** Set when the token is used, or when a newer reset or a completed reset replaces it. */
    usedAt: instant('used_at'),
  },
  (t) => [
    uniqueIndex('password_reset_token_hash_key').on(t.tokenHash),
    index('password_reset_token_user_idx').on(t.userId),
    check('password_reset_token_expires_after_created', sql`"expires_at" > "created_at"`),
  ],
);

export const practitioners = pgTable(
  'practitioner',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    bio: text('bio').notNull(),
    /** ISO weekdays the practitioner works: Monday 1 to Sunday 7. */
    workingDays: smallint('working_days').array().notNull(),
    /** Local wall-clock time in the clinic's time zone, 'HH:MM'. */
    workdayStart: text('workday_start').notNull(),
    workdayEnd: text('workday_end').notNull(),
    active: boolean('active').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [
    check(
      'practitioner_workday_format',
      sql`"workday_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "workday_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check('practitioner_workday_order', sql`"workday_end" > "workday_start"`),
    check('practitioner_working_days_valid', sql`"working_days" <@ array[1,2,3,4,5,6,7]::smallint[]`),
    index('practitioner_active_idx').on(t.active),
  ],
);

export const slots = pgTable(
  'slot',
  {
    id: uuid('id').primaryKey(),
    practitionerId: uuid('practitioner_id')
      .notNull()
      .references(() => practitioners.id),
    startsAt: instant('starts_at').notNull(),
    endsAt: instant('ends_at').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('slot_practitioner_start_key').on(t.practitionerId, t.startsAt),
    index('slot_starts_at_idx').on(t.startsAt),
    check('slot_ends_after_start', sql`"ends_at" > "starts_at"`),
  ],
);

export const bookings = pgTable(
  'booking',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => users.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id),
    status: bookingStatus('status').notNull(),
    lateCancellation: boolean('late_cancellation').notNull(),
    phone: text('phone'),
    rescheduleCount: integer('reschedule_count').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
    cancelledAt: instant('cancelled_at'),
  },
  (t) => [
    // At most one confirmed booking per slot, so concurrent bookings of the
    // same slot cannot both succeed. Cancelled bookings free the slot.
    uniqueIndex('booking_one_confirmed_per_slot')
      .on(t.slotId)
      .where(sql`"status" = 'confirmed'`),
    index('booking_patient_idx').on(t.patientId),
    check('booking_cancelled_at_matches_status', sql`("status" = 'cancelled') = ("cancelled_at" is not null)`),
    check('booking_late_only_when_cancelled', sql`not "late_cancellation" or "status" = 'cancelled'`),
    check('booking_reschedule_count_nonnegative', sql`"reschedule_count" >= 0`),
  ],
);

export const clinicSettings = pgTable(
  'clinic_settings',
  {
    id: smallint('id').primaryKey(),
    clinicName: text('clinic_name').notNull(),
    timeZone: text('time_zone').notNull(),
    lateCancellationHours: integer('late_cancellation_hours').notNull(),
    includeContactInConfirmation: boolean('include_contact_in_confirmation').notNull(),
    slotHorizonDays: integer('slot_horizon_days').notNull(),
    sessionMinutes: integer('session_minutes').notNull(),
    maxReschedulesPerBooking: integer('max_reschedules_per_booking').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  () => [
    check('clinic_settings_single_row', sql`"id" = 1`),
    check(
      'clinic_settings_ranges',
      sql`"late_cancellation_hours" between 0 and 336 and "slot_horizon_days" between 1 and 366 and "session_minutes" between 5 and 480 and "max_reschedules_per_booking" between 0 and 20`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type PractitionerRow = typeof practitioners.$inferSelect;
export type SlotRow = typeof slots.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
export type ClinicSettingsRow = typeof clinicSettings.$inferSelect;
