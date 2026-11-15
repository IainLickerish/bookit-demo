import type { BookingDependencies } from '@/server/bookings/book';
import { BOOKING_ERRORS } from '@/server/bookings/errors';
import { findBookingForPatient } from '@/server/bookings/queries';
import { findSessionUser } from '@/server/auth/session';
import { loadClinicSettings } from '@/server/settings';
import { appointmentCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from './appointment';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Authenticate in this clinic's database before looking up the patient's own booking. */
export async function calendarResponse(
  deps: Pick<BookingDependencies, 'db' | 'clock' | 'log'>,
  token: string | undefined,
  bookingId: string,
): Promise<Response> {
  try {
    const user = token ? await findSessionUser(deps.db, deps.clock, token) : null;
    if (!user || user.role !== 'patient') {
      return new Response('Sign in as a client to download your calendar file.', {
        status: user ? 403 : 401,
        headers: privateHeaders,
      });
    }
    const booking = await findBookingForPatient(deps.db, user.id, bookingId);
    if (!booking || booking.status !== 'confirmed') {
      return new Response(BOOKING_ERRORS.booking_not_found.message, { status: 404, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(deps.db);
    return new Response(appointmentCalendar(booking, settings), {
      headers: {
        ...privateHeaders,
        'Content-Type': CALENDAR_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${CALENDAR_FILENAME}"`,
      },
    });
  } catch {
    // Provider errors can contain personal data. Never log the exception or calendar body.
    deps.log.error({ event: 'calendar.download_failed' }, 'Calendar download unavailable');
    return new Response(null, {
      status: 303,
      headers: { ...privateHeaders, Location: '/bookings?error=calendar_unavailable' },
    });
  }
}
