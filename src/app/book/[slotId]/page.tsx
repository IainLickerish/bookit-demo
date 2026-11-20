import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { formatSlot, localDateOf } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { bookAction } from '../../bookings/actions';
import { dayViewHref } from '../../day-picker';
import { errorText, single, type SearchParams } from '../../messages';
import { ConfirmBookingButton } from './confirm-booking-button';

export default async function BookSlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ slotId: string }>;
  searchParams: SearchParams;
}) {
  const patient = await requirePatient();
  const { slotId } = await params;
  const error = errorText(single((await searchParams).error));
  const db = getDatabase();
  const [settings, slot] = await Promise.all([loadClinicSettings(db), findBookableSlot(db, slotId)]);
  if (!slot) {
    notFound();
  }
  const free = await isSlotFree(db, slot.id);
  const choicesHref = dayViewHref('/slots', slot.practitionerId, localDateOf(slot.startsAt, settings.timeZone));
  const { lateCancellationHours } = settings;
  return (
    <section className="booking-flow booking-review">
      <h1>Confirm your booking</h1>
      <p className="mb-6">Check your session details before you confirm.</p>
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <dl className="booking-details">
        <div>
          <dt>Physiotherapist</dt>
          <dd data-testid="book-practitioner">{slot.practitionerName}</dd>
        </div>
        <div>
          <dt>Date and time</dt>
          <dd className="tabular-nums" data-testid="book-when">
            {formatSlot(slot.startsAt, settings.timeZone)}
          </dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{settings.sessionMinutes} minutes</dd>
        </div>
      </dl>
      {free && lateCancellationHours > 0 ? (
        <p className="mb-4 text-sm">
          Cancelling less than {lateCancellationHours} {lateCancellationHours === 1 ? 'hour' : 'hours'} before your
          session counts as a late cancellation.
        </p>
      ) : null}
      {free ? (
        <form action={bookAction} className="space-y-4">
          <input type="hidden" name="slotId" value={slot.id} />
          <label>
            Phone number (optional)
            <input
              type="tel"
              name="phone"
              autoComplete="tel"
              defaultValue={patient.phone ?? ''}
              data-testid="book-phone"
            />
          </label>
          <ConfirmBookingButton />
        </form>
      ) : (
        <p className="alert" role="alert" data-testid="slot-taken">
          Sorry, this time is no longer available. Please choose a different time.
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href={choicesHref} prefetch={false} className="booking-back" data-testid="choose-different-time">
          Choose a different time
        </Link>
      </p>
    </section>
  );
}
