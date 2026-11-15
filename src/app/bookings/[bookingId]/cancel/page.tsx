import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { clinicWords } from '@/lib/booking-paths';
import { cancellationReview } from '@/server/bookings/review';
import { requirePatient } from '@/server/request-context';
import { CANCEL_REVIEW_CONSEQUENCE, errorText, single, type SearchParams } from '../../../messages';
import { cancelAction } from '../../actions';
import { BookingDetails } from '../../booking-details';
import { ReviewError } from '../../review-error';

export default async function CancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: SearchParams;
}) {
  const { bookingId } = await params;
  const patient = await requirePatient(`/bookings/${bookingId}/cancel`);
  const review = await cancellationReview(getDatabase(), getClock(), patient.id, bookingId).catch((error: unknown) => ({
    error,
  }));
  if ('error' in review) return <ReviewError error={review.error} />;
  const { booking, settings, late } = review;
  const error = errorText(single((await searchParams).error));
  return (
    <section className="max-w-md">
      <h1>Cancel your {clinicWords().booking}</h1>
      <p>Review your current booking before you confirm cancellation.</p>
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <BookingDetails booking={booking} timeZone={settings.timeZone} prefix="review-current" />
      <p className="notice" data-testid="cancel-consequences">
        {CANCEL_REVIEW_CONSEQUENCE}
      </p>
      <p data-testid="cancel-window">
        {late ? 'This is a late cancellation.' : 'This is not a late cancellation.'} The late-cancellation window is{' '}
        {settings.lateCancellationHours} hours.
      </p>
      <form action={cancelAction} className="mt-6">
        <input type="hidden" name="bookingId" value={booking.id} />
        <input type="hidden" name="expectedSlotId" data-testid="review-slot" value={booking.slotId} />
        <input type="hidden" name="expectedLate" data-testid="review-late" value={String(late)} />
        <button type="submit" className="button inline-flex min-h-12 items-center" data-testid="confirm-cancellation">
          Confirm cancellation
        </button>
      </form>
      <p className="mt-6">
        <Link href="/bookings" prefetch={false} className="button-secondary inline-flex min-h-12 items-center">
          Keep my booking
        </Link>
      </p>
    </section>
  );
}
