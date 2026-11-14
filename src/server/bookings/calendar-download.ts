import type { Clock } from '@/lib/clock';
import type { Database } from '@/db/client';
import { findSessionUser } from '../auth/session';
import { withoutQueryDetails } from '../errors';
import { loadClinicSettings } from '../settings';
import { bookingCalendar } from './calendar';
import { BOOKING_ERRORS } from './errors';
import { findBookingForPatient } from './queries';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
};

/** Resolve both the session and the booking against this clinic's database. */
export async function calendarDownloadResponse(
  db: Database,
  clock: Clock,
  token: string | undefined,
  bookingId: string,
): Promise<Response> {
  try {
    const user = token ? await findSessionUser(db, clock, token) : null;
    if (!user || user.role !== 'patient') {
      return new Response(BOOKING_ERRORS.calendar_sign_in.message, {
        status: user ? 403 : 401,
        headers: privateHeaders,
      });
    }
    const booking = await findBookingForPatient(db, user.id, bookingId);
    if (!booking || booking.status !== 'confirmed' || booking.startsAt <= clock.now()) {
      return new Response(BOOKING_ERRORS.calendar_unavailable.message, { status: 404, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(db);
    return new Response(bookingCalendar(booking, settings), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/calendar; charset=utf-8; method=PUBLISH',
        'Content-Disposition': 'attachment; filename="booking.ics"',
      },
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
