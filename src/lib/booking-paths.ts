const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const destination = new RegExp(`^/bookings/${UUID}/(?:cancel|reschedule(?:/${UUID})?)$`);

/** Only the booking destinations this journey owns, never an arbitrary redirect URL. */
export function bookingReturnTo(value: unknown): string | null {
  return typeof value === 'string' && destination.exec(value)?.[0] === value ? value : null;
}

export function clinicWords(tenant = process.env.BOOKIT_TENANT) {
  return tenant === 'acme'
    ? { booking: 'session', practitioner: 'Physiotherapist' }
    : { booking: 'appointment', practitioner: 'Clinician' };
}
