import type { BlockError } from '@/server/admin/blocked-periods';
import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';

const NOTICES = {
  booked: 'Booking confirmed.',
  cancelled: 'Booking cancelled.',
  cancelled_late: 'Booking cancelled. This was a late cancellation.',
  rescheduled: 'Booking rescheduled.',
  time_blocked: 'Time blocked.',
} as const;

export const BLOCK_ERRORS = {
  invalid_practitioner: 'Choose a physiotherapist.',
  invalid_start: 'Enter a valid start date and time in the clinic’s time zone.',
  invalid_end: 'Enter a valid end date and time in the clinic’s time zone.',
  invalid_reason: 'Shorten the reason to 240 characters or fewer.',
  invalid_order: 'Choose an end time after the start time.',
} satisfies Record<BlockError, string>;

export const BLOCK_REVIEW_CHANGED = 'The block details or bookings have changed. Check them again before saving.';

export type NoticeCode = keyof typeof NOTICES;

export function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Text for a notice code from the query string; unknown codes show nothing. */
export function noticeText(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(NOTICES, code) ? NOTICES[code as NoticeCode] : null;
}

/** Text for a booking error code from the query string. */
export function errorText(code: string | undefined): string | null {
  return isBookingErrorCode(code) ? BOOKING_ERRORS[code].message : null;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
