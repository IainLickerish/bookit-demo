import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { clinicWords } from '@/lib/booking-paths';
import { rescheduleReview } from '@/server/bookings/review';
import { requirePatient } from '@/server/request-context';
import { MOVE_REVIEW_CONSEQUENCE } from '../../../../messages';
import { rescheduleAction } from '../../../actions';
import { BookingDetails } from '../../../booking-details';
import { ReviewError } from '../../../review-error';

export default async function ConfirmReschedulePage({
  params,
}: {
  params: Promise<{ bookingId: string; slotId: string }>;
}) {
  const { bookingId, slotId } = await params;
  const patient = await requirePatient(`/bookings/${bookingId}/reschedule/${slotId}`);
  const review = await rescheduleReview(getDatabase(), getClock(), patient.id, bookingId, slotId).catch(
    (error: unknown) => ({ error }),
  );
  if ('error' in review) return <ReviewError error={review.error} />;
  const { booking, settings, target } = review;
  return (
    <section className="max-w-md">
      <h1>Confirm your new {clinicWords().booking} time</h1>
      <p>Review both times before you confirm the move.</p>
      <h2>Current booking</h2>
      <BookingDetails booking={booking} timeZone={settings.timeZone} prefix="review-current" />
      <h2>New booking</h2>
      <BookingDetails booking={target} timeZone={settings.timeZone} prefix="review-new" />
      <p className="notice" data-testid="reschedule-consequences">
        {MOVE_REVIEW_CONSEQUENCE}
      </p>
      <p>
        This uses one of your {settings.maxReschedulesPerBooking - booking.rescheduleCount} remaining reschedules. New
        times must be within {settings.slotHorizonDays} days.
      </p>
      <form action={rescheduleAction} className="mt-6">
        <input type="hidden" name="bookingId" value={booking.id} />
        <input type="hidden" name="newSlotId" value={target.id} />
        <input type="hidden" name="expectedSlotId" data-testid="review-slot" value={booking.slotId} />
        <button type="submit" className="button inline-flex min-h-12 items-center" data-testid="confirm-reschedule">
          Confirm reschedule
        </button>
      </form>
      <p className="mt-6">
        <Link
          href={`/bookings/${booking.id}/reschedule`}
          prefetch={false}
          className="button-secondary inline-flex min-h-12 items-center"
        >
          Choose a different time
        </Link>
      </p>
      <p className="mt-4">
        <Link href="/bookings" prefetch={false} className="underline">
          Keep my current booking
        </Link>
      </p>
    </section>
  );
}
