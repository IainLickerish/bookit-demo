import { findSessionUser } from '../auth/session';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import type { BookingDependencies } from './book';
import { bookingCalendar } from './calendar';
import { findBookingForPatient } from './queries';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function bookingCalendarResponse(
  deps: Pick<BookingDependencies, 'db' | 'clock'>,
  token: string | undefined,
  bookingId: string,
): Promise<Response> {
  try {
    const user = token ? await findSessionUser(deps.db, deps.clock, token) : null;
    if (!user || user.role !== 'patient') {
      return new Response(user ? 'Client access required' : 'Sign-in required', {
        status: user ? 403 : 401,
        headers: privateHeaders,
      });
    }
    const booking = await findBookingForPatient(deps.db, user.id, bookingId);
    if (!booking || booking.status !== 'confirmed' || booking.startsAt <= deps.clock.now()) {
      return new Response('Booking not found', { status: 404, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(deps.db);
    return new Response(bookingCalendar(booking, settings), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="booking.ics"',
      },
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
