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
  saved: 'Blocked period saved.',
  invalid: 'The blocked period could not be saved. Correct the fields below and try again.',
} as const;

export const BLOCK_FIELD_ERRORS = {
  practitionerId: 'Choose someone from the list.',
  reason: 'Keep the reason to 500 characters or fewer.',
  dateTime: 'Enter a valid date and time.',
  start: 'Enter a valid start date and time in the clinic’s time zone. This time may be skipped when clocks change.',
  end: 'Enter a valid end date and time in the clinic’s time zone. This time may be skipped when clocks change.',
  endBeforeStart: 'Enter an end date and time after the start.',
} as const;
