import { getDatabase } from '@/db/client';
import { bookingCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from '@/server/bookings/calendar';
import { findBookingForPatient } from '@/server/bookings/queries';
import { withoutQueryDetails } from '@/server/errors';
import { currentUser } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  try {
    const user = await currentUser();
    if (user?.role !== 'patient') {
      return new Response(null, { status: user ? 403 : 401, headers: privateHeaders });
    }
    const { bookingId } = await params;
    const db = getDatabase();
    const booking = await findBookingForPatient(db, user.id, bookingId);
    if (booking?.status !== 'confirmed') {
      return new Response(null, { status: 404, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(db);
    return new Response(bookingCalendar(booking, settings.clinicName), {
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
