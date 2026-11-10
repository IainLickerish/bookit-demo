import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { findBookingForPatient } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { cancelAction } from '../../actions';

/** Opened from the reminder email: shows the booking and asks before cancelling. */
export default async function CancelBookingPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const patient = await requirePatient();
  const { bookingId } = await params;
  const db = getDatabase();
  const booking = await findBookingForPatient(db, patient.id, bookingId);
  if (!booking) {
    notFound();
  }
  const settings = await loadClinicSettings(db);
  const cancellable = booking.status === 'confirmed' && booking.startsAt > getClock().now();
  return (
    <section>
      <h1>Cancel your appointment</h1>
      <p className="mb-4">
        <span className="font-medium" data-testid="cancel-when">
          {formatSlot(booking.startsAt, settings.timeZone)}
        </span>{' '}
        with {booking.practitionerName}.
      </p>
      {cancellable ? (
        <form action={cancelAction}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <button type="submit" className="button" data-testid="confirm-cancel">
            Cancel this appointment
          </button>
        </form>
      ) : (
        <p className="alert" data-testid="not-cancellable">
          This booking can no longer be cancelled online.
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href="/bookings" prefetch={false} className="underline">
          Keep it and go back to my bookings
        </Link>
      </p>
    </section>
  );
}
