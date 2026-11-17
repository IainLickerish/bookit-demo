import { findSessionUser } from '../auth/session';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import type { BookingDependencies } from './book';
import { bookingCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from './calendar';
import { BOOKING_ERRORS } from './errors';
import { findBookingForPatient } from './queries';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function bookingCalendarResponse(
  deps: Pick<BookingDependencies, 'db' | 'clock'>,
  token: string | undefined,
  bookingId: string,
): Promise<Response> {
  try {
    const user = token ? await findSessionUser(deps.db, deps.clock, token) : null;
    const booking = user?.role === 'patient' ? await findBookingForPatient(deps.db, user.id, bookingId) : null;
    if (!booking || booking.status !== 'confirmed' || booking.startsAt <= deps.clock.now()) {
      return new Response(BOOKING_ERRORS.booking_not_found.message, { status: 404, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(deps.db);
    return new Response(bookingCalendar(booking, settings), {
      headers: {
        ...privateHeaders,
        'Content-Type': CALENDAR_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${CALENDAR_FILENAME}"`,
      },
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
