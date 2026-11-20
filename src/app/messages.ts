import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';

const NOTICES = {
  booked: 'Booking confirmed.',
  cancelled: 'Booking cancelled.',
  cancelled_late: 'Booking cancelled. This was a late cancellation.',
  rescheduled: 'Booking rescheduled.',
} as const;

export type NoticeCode = keyof typeof NOTICES;

export const TIME_BLOCK_MESSAGES = {
  invalid_fields: 'Choose a physiotherapist and enter valid dates and times. Keep the reason to 240 characters.',
  invalid_practitioner: 'This physiotherapist is no longer available. Choose another.',
  invalid_range: 'The end must be after the start. Check the dates and times and try again.',
  clock_change: 'A time you entered is skipped or repeated when the clocks change. Choose a different time.',
  review_changed: 'The details have changed since your last review. Check them again before saving.',
  saved: 'Time block saved.',
} as const;

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
