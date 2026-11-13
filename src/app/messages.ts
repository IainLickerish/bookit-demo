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

export const CALENDAR_MESSAGES = {
  copied: 'Calendar details copied. Paste them into a new event in your calendar.',
  failed:
    'Sorry, the details could not be copied. Copy the selected text yourself, or type the details into your calendar.',
  manualUpdate:
    'If you move or cancel your booking, update or remove the existing event in your calendar yourself. BookIt does not update your calendar.',
} as const;
