import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { clinicWords } from '@/lib/clinic-words';
import { getClock } from '@/lib/clock';
import { addDays, formatSlot } from '@/lib/time';
import { findBookingForPatient } from '@/server/bookings/queries';
import { isLateCancellation } from '@/server/bookings/rules';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { single, type SearchParams } from '../../../messages';
import { cancelAction, rescheduleAction } from '../../actions';

export default async function ReviewBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: SearchParams;
}) {
  const { bookingId } = await params;
  const query = await searchParams;
  const slotId = single(query.slot);
  const path = `/bookings/${bookingId}/review${slotId ? `?slot=${encodeURIComponent(slotId)}` : ''}`;
  const patient = await requirePatient(path);
  const db = getDatabase();
  const booking = await findBookingForPatient(db, patient.id, bookingId);
  if (!booking) notFound();
  const settings = await loadClinicSettings(db);
  const words = clinicWords();
  const now = getClock().now();
  const target = slotId ? await findBookableSlot(db, slotId) : null;
  const active = booking.status === 'confirmed' && booking.startsAt > now;
  const available =
    !slotId ||
    (target &&
      target.startsAt > now &&
      target.startsAt <= addDays(now, settings.slotHorizonDays) &&
      target.id !== booking.slotId &&
      (await isSlotFree(db, target.id)));
  const remaining = Math.max(0, settings.maxReschedulesPerBooking - booking.rescheduleCount);
  const changeable = active && available && (!slotId || remaining > 0);
  const late = active && isLateCancellation(booking.startsAt, now, settings);
  return (
    <section className="reminder-journey booking-review">
      <h1>{slotId ? `Confirm your new ${words.appointment}` : `Cancel your ${words.appointment}`}</h1>
      <p>Check your current details and what will happen before you confirm.</p>
      <h2>Current booking</h2>
      <div data-testid="review-current">
        <p>
          {formatSlot(booking.startsAt, settings.timeZone)} ({settings.timeZone})
        </p>
        <p>
          Your {words.practitioner}: {booking.practitionerName}
        </p>
        <p>Duration: {(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes</p>
        <p>Status: {booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}</p>
      </div>
      {slotId && target ? (
        <>
          <h2>New booking</h2>
          <div data-testid="review-new">
            <p>
              {formatSlot(target.startsAt, settings.timeZone)} ({settings.timeZone})
            </p>
            <p>
              Your {words.practitioner}: {target.practitionerName}
            </p>
            <p>Duration: {(target.endsAt.getTime() - target.startsAt.getTime()) / 60_000} minutes</p>
          </div>
        </>
      ) : null}
      {changeable ? (
        <>
          <p className="notice" data-testid="review-consequences">
            {slotId
              ? `Your old time is released only when the new time is secured. This uses 1 of your ${remaining} remaining moves. The new time must be within ${settings.slotHorizonDays} days. Reminder eligibility starts again for the new time.`
              : `Cancelling releases your time for someone else. No further reminder will be sent for this booking. Cancellations within ${settings.lateCancellationHours} hours are late cancellations.${late ? ' This will be recorded as a late cancellation.' : ' This is outside the late-cancellation window.'}`}
          </p>
          <form action={slotId ? rescheduleAction : cancelAction} className="booking-confirmation mt-6">
            <input type="hidden" name="bookingId" value={booking.id} />
            <input type="hidden" name="revision" value={booking.rescheduleCount} />
            {slotId ? <input type="hidden" name="newSlotId" value={slotId} /> : null}
            <button type="submit" className="button" data-testid="confirm-change">
              {slotId ? 'Confirm reschedule' : 'Confirm cancellation'}
            </button>
          </form>
        </>
      ) : (
        <p role="status" className="notice" data-testid="review-unavailable">
          {!active
            ? 'This booking can no longer be changed online. Check My bookings for its current status.'
            : remaining === 0
              ? 'You have used all your moves. Please contact the clinic.'
              : 'That time is no longer available. Please choose another time. Your current booking is unchanged.'}
        </p>
      )}
      <p className="mt-6 flex flex-wrap gap-4">
        <Link href="/bookings" prefetch={false} className="button-secondary" data-testid="review-back">
          Back to my bookings
        </Link>
        {slotId && active && remaining > 0 ? (
          <Link href={`/bookings/${booking.id}/reschedule`} prefetch={false} className="button-secondary">
            Choose another time
          </Link>
        ) : null}
      </p>
    </section>
  );
}
