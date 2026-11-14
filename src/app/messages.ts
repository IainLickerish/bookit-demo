import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';

const NOTICES = {
  booked: 'Booking confirmed.',
  cancelled: 'Booking cancelled.',
  cancelled_late: 'Booking cancelled. This was a late cancellation.',
  rescheduled: 'Booking rescheduled.',
} as const;

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

export const BLOCK_MESSAGES = {
  saved: 'Blocked time saved.',
  invalid: 'The blocked time could not be saved. Correct the fields below and try again.',
  practitioner: 'Choose a name from this clinic’s list.',
  invalid_time: 'Enter a valid date and time in the clinic’s time zone.',
  skipped_time: 'This time is skipped when the clocks go forward. Choose a time before or after the clock change.',
  repeated_time: 'This time occurs twice when the clocks go back. Choose a time before or after the repeated hour.',
  end_order: 'Enter an end after the start.',
  reason_long: 'Keep the reason to 500 characters or fewer.',
  noConflicts: 'No confirmed bookings overlap this blocked time.',
  conflicts:
    'Confirmed bookings overlap this blocked time. Contact the clients to arrange another time. Their bookings have not been changed.',
} as const;
