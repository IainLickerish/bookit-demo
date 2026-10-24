export const BOOKING_ERRORS = {
  not_a_patient: {
    status: 403,
    message: 'Only patients can book appointments.',
  },
  slot_not_found: {
    status: 404,
    message: 'That appointment slot does not exist.',
  },
  slot_unavailable: {
    status: 409,
    message: 'Sorry, that slot has just been booked. Please choose another.',
  },
  slot_in_past: {
    status: 409,
    message: 'That slot has already started. Please choose a later one.',
  },
  slot_beyond_horizon: {
    status: 422,
    message: 'That slot is further ahead than bookings are open.',
  },
  invalid_phone: {
    status: 422,
    message: 'Please enter a valid phone number, or leave it empty.',
  },
  booking_not_found: {
    status: 404,
    message: 'We could not find that booking.',
  },
  booking_not_active: {
    status: 409,
    message: 'That booking is already cancelled.',
  },
  booking_already_started: {
    status: 409,
    message: 'That appointment has already started, so it cannot be changed online.',
  },
  reschedule_limit_reached: {
    status: 409,
    message: 'That booking has been rescheduled as many times as the clinic allows. Please contact the clinic.',
  },
  same_slot: {
    status: 422,
    message: 'Please choose a different slot from your current one.',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type BookingErrorCode = keyof typeof BOOKING_ERRORS;

export function isBookingErrorCode(value: unknown): value is BookingErrorCode {
  return typeof value === 'string' && Object.hasOwn(BOOKING_ERRORS, value);
}

export class BookingError extends Error {
  override readonly name = 'BookingError';
  readonly code: BookingErrorCode;
  readonly status: number;

  constructor(code: BookingErrorCode) {
    super(BOOKING_ERRORS[code].message);
    this.code = code;
    this.status = BOOKING_ERRORS[code].status;
  }
}
