import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { findBookingForPatient } from '@/server/bookings/queries';
import { bookingCalendarFile, CALENDAR_CONTENT_TYPE, calendarFileName } from '@/server/calendar/appointment';
import { currentUser } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

const NOT_FOUND = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * The calendar file for one of the signed-in patient's own confirmed
 * bookings. Another patient's booking, or a cancelled one, is "not found".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const user = await currentUser();
  if (!user) {
    return new Response(null, { status: 303, headers: { Location: '/auth/sign-in', 'Cache-Control': 'no-store' } });
  }
  if (user.role !== 'patient') {
    return NOT_FOUND();
  }
  const { bookingId } = await params;
  const db = getDatabase();
  const booking = await findBookingForPatient(db, user.id, bookingId);
  if (!booking || booking.status !== 'confirmed') {
    return NOT_FOUND();
  }
  const settings = await loadClinicSettings(db);
  return new Response(bookingCalendarFile(booking, settings, getClock().now()), {
    headers: {
      'Content-Type': CALENDAR_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${calendarFileName(booking, settings)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
