import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';
import type { TimeBlockErrorCode } from '@/server/admin/time-blocks';

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

export const TIME_BLOCK_SAVED = 'Time block saved.';
export const TIME_BLOCK_ERRORS: Record<TimeBlockErrorCode, string> = {
  practitionerId: 'Choose a physiotherapist.',
  startsAt: 'Enter a valid start date and time.',
  endsAt: 'Enter a valid end date and time.',
  reason: 'Shorten the reason to 500 characters or fewer.',
  order: 'Choose an end time after the start time.',
  clock_change: 'The clocks change at that time. Choose a different time.',
};

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
