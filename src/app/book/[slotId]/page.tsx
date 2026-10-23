import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { bookAction } from '../../bookings/actions';
import { errorText, single, type SearchParams } from '../../messages';

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
  return (
    <section className="max-w-md">
      <h1>Confirm your booking</h1>
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <dl className="mb-6 space-y-1">
        <div>
          <dt className="inline font-medium">With: </dt>
          <dd className="inline" data-testid="book-practitioner">
            {slot.practitionerName}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">When: </dt>
          <dd className="inline" data-testid="book-when">
            {formatSlot(slot.startsAt, settings.timeZone)} ({settings.sessionMinutes} minutes)
          </dd>
        </div>
      </dl>
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
          <button type="submit" className="button" data-testid="confirm-booking">
            Confirm booking
          </button>
        </form>
      ) : (
        <p className="alert" data-testid="slot-taken">
          This time is no longer available.
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href="/slots" prefetch={false} className="underline">
          Choose a different time
        </Link>
      </p>
    </section>
  );
}
