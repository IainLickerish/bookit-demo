import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { bookingCalendar, CALENDAR_CONTENT_TYPE, CALENDAR_FILENAME } from '@/server/bookings/calendar';
import { findBookingForPatient } from '@/server/bookings/queries';
import { isUpcomingBooking } from '@/server/bookings/rules';
import { withoutQueryDetails } from '@/server/errors';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const patient = await requirePatient();
    const { bookingId } = await params;
    const db = getDatabase();
    const booking = await findBookingForPatient(db, patient.id, bookingId);
    if (!booking || !isUpcomingBooking(booking, getClock().now())) {
      return new Response(null, { status: 404, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(db);
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
