import { getDatabase } from '@/db/client';
import { bookingCalendar } from '@/server/bookings/calendar';
import { findBookingForPatient } from '@/server/bookings/queries';
import { currentUser } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' };
  const user = await currentUser();
  if (!user || user.role !== 'patient') return new Response('Please sign in as a client.', { status: 401, headers });
  const db = getDatabase();
  const booking = await findBookingForPatient(db, user.id, (await params).bookingId);
  if (!booking || booking.status !== 'confirmed') return new Response('Booking not found.', { status: 404, headers });
  const settings = await loadClinicSettings(db);
  return new Response(bookingCalendar(booking, settings), {
    headers: {
      ...headers,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointment-${booking.id}.ics"`,
    },
  });
}
