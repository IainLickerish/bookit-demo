import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { bookingCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from '@/server/bookings/calendar';
import { findBookingForPatient } from '@/server/bookings/queries';
import { isUpcomingBooking } from '@/server/bookings/rules';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger, requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const { bookingId } = await params;
  let calendar: string | undefined;
  try {
    const patient = await requirePatient();
    const db = getDatabase();
    const booking = await findBookingForPatient(db, patient.id, bookingId);
    if (booking && isUpcomingBooking(booking, getClock().now())) {
      calendar = bookingCalendar(booking, await loadClinicSettings(db));
    }
  } catch (error) {
    const safeError = withoutQueryDetails(error);
    if (safeError !== error) {
      (await requestLogger()).error({ event: 'booking.calendar_failed' }, 'Calendar download failed');
    }
    throw safeError;
  }
  if (calendar === undefined) {
    notFound();
  }
  return new Response(calendar, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': CALENDAR_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${CALENDAR_FILENAME}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
