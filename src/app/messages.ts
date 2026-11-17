import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';

const NOTICES = {
  booked: 'Booking confirmed.',
  block_saved: 'Blocked time saved.',
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
  practitionerId: 'Choose a practitioner from this clinic.',
  startsAt: 'Enter a valid start in the clinic time zone. Times skipped or repeated when clocks change cannot be used.',
  endsAt:
    'Enter an end after the start in the clinic time zone. Times skipped or repeated when clocks change cannot be used.',
  reason: 'Keep the reason to 500 characters or fewer.',
} as const;
