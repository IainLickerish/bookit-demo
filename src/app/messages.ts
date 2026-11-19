import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';
import type { BlockOutErrorCode } from '@/server/admin/block-outs';

const NOTICES = {
  booked: 'Booking confirmed.',
  cancelled: 'Booking cancelled.',
  cancelled_late: 'Booking cancelled. This was a late cancellation.',
  rescheduled: 'Booking rescheduled.',
  block_out_saved: 'Block-out saved.',
} as const;

export const BLOCK_OUT_MESSAGES = {
  invalid_practitioner: 'Choose a physiotherapist from the list.',
  invalid_start: 'Enter a start date and time that exists in the clinic’s time zone.',
  invalid_end: 'Enter an end date and time that exists in the clinic’s time zone.',
  invalid_range: 'Choose an end time after the start time.',
  invalid_reason: 'Enter a reason of 500 characters or fewer, or leave it empty.',
  time_zone_changed: 'The clinic’s time zone changed. Check both times in the new time zone before saving.',
} as const satisfies Record<BlockOutErrorCode, string>;

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
