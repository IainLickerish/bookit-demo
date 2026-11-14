import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { DateTile } from '../../date-tile';
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
    <section className="card account-card booking-step" data-testid="booking-card">
      <header className="page-header" data-testid="client-page-header">
        <h1>Confirm your booking</h1>
      </header>
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <div className="booking-summary">
        <DateTile instant={slot.startsAt} timeZone={settings.timeZone} />
        <dl className="booking-details">
          <div>
            <dt className="detail-label">With: </dt>
            <dd className="detail-value" data-testid="book-practitioner">
              {slot.practitionerName}
            </dd>
          </div>
          <div>
            <dt className="detail-label">When: </dt>
            <dd className="detail-value" data-testid="book-when">
              {formatSlot(slot.startsAt, settings.timeZone)} ({settings.sessionMinutes} minutes)
            </dd>
          </div>
        </dl>
      </div>
      {free ? (
        <form action={bookAction} className="form-stack">
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
          <div className="mobile-action-bar" data-testid="booking-action-bar">
            <button type="submit" className="button" data-testid="confirm-booking">
              Confirm booking
            </button>
          </div>
        </form>
      ) : (
        <p className="alert" data-testid="slot-taken">
          This time is no longer available.
        </p>
      )}
      <p className="page-back-link">
        <Link href="/slots" prefetch={false} className="underline">
          Choose a different time
        </Link>
      </p>
    </section>
  );
}
