import Link from 'next/link';
import { BOOKING_ERRORS } from '@/server/bookings/errors';
export default function BookingNotFound() {
  return (
    <section>
      <h1>Booking not found</h1>
      <p role="alert" className="alert" data-testid="booking-error">
        {BOOKING_ERRORS.booking_not_found.message}
      </p>
      <Link href="/bookings" prefetch={false} className="button-secondary inline-flex min-h-12 items-center">
        Back to my bookings
      </Link>
    </section>
  );
}
