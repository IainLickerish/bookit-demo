import type { BookingDependencies } from '@/server/bookings/book';
import { BOOKING_ERRORS } from '@/server/bookings/errors';
import { findBookingForPatient } from '@/server/bookings/queries';
import { findSessionUser } from '@/server/auth/session';
import { loadClinicSettings } from '@/server/settings';
import { withoutQueryDetails } from '@/server/errors';
import { reportError } from '@/server/error-reporting';
import { appointmentCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from './appointment';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Keep code locations for diagnosis, without arbitrary messages, causes or attached data. */
function downloadError(error: unknown): unknown {
  const safe = withoutQueryDetails(error);
  if (safe !== error) return safe;

  const reported = new Error('Calendar download failed');
  if (error instanceof Error) {
    // Remove the whole message, including any embedded newlines, before keeping the stack frames.
    const heading = `${error.name}: ${error.message}`;
    if (error.stack?.startsWith(`${heading}\n`)) {
      const frames = error.stack
        .slice(heading.length)
        .split('\n')
        .filter((line) => line.trimStart().startsWith('at '));
      reported.stack = `${reported.name}: ${reported.message}\n${frames.join('\n')}`;
    }
  }
  return reported;
}

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
  } catch (error) {
    // Provider errors can contain personal data. Never log the exception or calendar body.
    deps.log.error({ event: 'calendar.download_failed' }, 'Calendar download unavailable');
    reportError(downloadError(error), { operation: 'calendar.download' });
    return new Response(null, {
      status: 303,
      headers: { ...privateHeaders, Location: '/bookings?error=calendar_unavailable' },
    });
  }
}
