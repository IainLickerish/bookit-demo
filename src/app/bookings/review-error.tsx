import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookingError } from '@/server/bookings/errors';
import { withoutQueryDetails } from '@/server/errors';

export function ReviewError({ error }: { error: unknown }) {
  if (!(error instanceof BookingError)) throw withoutQueryDetails(error);
  if (error.code === 'booking_not_found') notFound();
  return (
    <section>
      <h1>Review your booking</h1>
      <p role="alert" className="alert" data-testid="booking-error">
        {error.message}
      </p>
      <Link href="/bookings" prefetch={false} className="button-secondary inline-flex min-h-12 items-center">
        Back to my bookings
      </Link>
    </section>
  );
}
