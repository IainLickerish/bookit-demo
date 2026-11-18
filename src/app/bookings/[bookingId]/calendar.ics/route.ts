import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { BOOKING_CALENDAR_CONTENT_TYPE, BOOKING_CALENDAR_FILENAME, bookingCalendar } from '@/server/bookings/calendar';
import { findBookingForPatient } from '@/server/bookings/queries';
import { withoutQueryDetails } from '@/server/errors';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  try {
    const patient = await requirePatient();
    const { bookingId } = await params;
    const db = getDatabase();
    const booking = await findBookingForPatient(db, patient.id, bookingId);
    if (!booking || booking.status !== 'confirmed' || booking.startsAt <= getClock().now()) {
      notFound();
    }
    const settings = await loadClinicSettings(db);
    return new Response(bookingCalendar(booking, settings), {
      headers: {
        'Content-Type': BOOKING_CALENDAR_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${BOOKING_CALENDAR_FILENAME}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
