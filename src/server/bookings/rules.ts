import { z } from 'zod';
import { addDays } from '@/lib/time';
import type { ClinicSettings } from '../settings';
import { BookingError } from './errors';

const PHONE_PATTERN = /^\+?[0-9(][0-9 ()-]{5,24}$/;
const MIN_PHONE_DIGITS = 6;

function isPhoneNumber(value: string): boolean {
  return PHONE_PATTERN.test(value) && value.replace(/\D/g, '').length >= MIN_PHONE_DIGITS;
}

/** Optional phone number: blank becomes null. */
export const phoneInput = z
  .string()
  .trim()
  .max(32)
  .nullish()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || isPhoneNumber(value), 'Invalid phone number');

export function normalisePhone(raw: unknown): string | null {
  const parsed = phoneInput.safeParse(raw ?? null);
  if (!parsed.success) {
    throw new BookingError('invalid_phone');
  }
  return parsed.data;
}

type HorizonSettings = Pick<ClinicSettings, 'slotHorizonDays'>;

/** The latest start time a patient may book: now plus the booking horizon. */
export function bookingHorizonEnd(now: Date, settings: HorizonSettings): Date {
  return addDays(now, settings.slotHorizonDays);
}

export function assertSlotBookable(slotStartsAt: Date, now: Date, settings: HorizonSettings): void {
  if (slotStartsAt.getTime() <= now.getTime()) {
    throw new BookingError('slot_in_past');
  }
  if (slotStartsAt.getTime() > bookingHorizonEnd(now, settings).getTime()) {
    throw new BookingError('slot_beyond_horizon');
  }
}

/**
 * Whether cancelling now is a late cancellation: the appointment starts in
 * less than the clinic's late-cancellation window. An appointment that has
 * started can no longer be cancelled.
 */
export function isLateCancellation(
  startsAt: Date,
  now: Date,
  settings: Pick<ClinicSettings, 'lateCancellationHours'>,
): boolean {
  const msAhead = startsAt.getTime() - now.getTime();
  if (msAhead <= 0) {
    throw new BookingError('booking_already_started');
  }
  return msAhead < settings.lateCancellationHours * 60 * 60 * 1000;
}

export interface ReschedulableBooking {
  status: 'confirmed' | 'cancelled';
  slotId: string;
  startsAt: Date;
  rescheduleCount: number;
}

/** Checks the booking may move; the target slot is checked separately. */
export function assertReschedulable(
  booking: ReschedulableBooking,
  newSlotId: string,
  now: Date,
  settings: Pick<ClinicSettings, 'maxReschedulesPerBooking'>,
): void {
  if (booking.status !== 'confirmed') {
    throw new BookingError('booking_not_active');
  }
  if (booking.startsAt.getTime() <= now.getTime()) {
    throw new BookingError('booking_already_started');
  }
  if (booking.rescheduleCount >= settings.maxReschedulesPerBooking) {
    throw new BookingError('reschedule_limit_reached');
  }
  if (booking.slotId === newSlotId) {
    throw new BookingError('same_slot');
  }
}
