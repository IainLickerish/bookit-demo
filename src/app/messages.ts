import { BOOKING_ERRORS, isBookingErrorCode } from '@/server/bookings/errors';

const NOTICES = {
  booked: 'Booking confirmed.',
  cancelled: 'Booking cancelled.',
  cancelled_late: 'Booking cancelled. This was a late cancellation.',
  rescheduled: 'Booking rescheduled.',
} as const;

export type NoticeCode = keyof typeof NOTICES;

export const SETTINGS_MESSAGES = {
  saved: 'Clinic settings saved.',
  invalid: 'Settings have not been saved. Correct the highlighted fields and save again.',
  unavailable: 'Sorry, settings could not be saved. Your entries are still here. Please try again.',
  fields: {
    clinicName: 'Enter a clinic name from 1 to 120 characters.',
    timeZone: 'Enter a valid time zone, for example Europe/London.',
    lateCancellationHours: 'Enter a whole number of hours from 0 to 336.',
  },
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
