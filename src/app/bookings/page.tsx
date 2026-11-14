import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { listBookingsForPatient, type BookingView } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { DateTile } from '../date-tile';
import { SlotText } from '../slot-text';
import { errorText, noticeText, single, type SearchParams } from '../messages';
import { cancelAction } from './actions';

function statusText(booking: BookingView): string {
  if (booking.status === 'confirmed') {
    return 'Confirmed';
  }
  return booking.lateCancellation ? 'Cancelled (late)' : 'Cancelled';
}

export default async function MyBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const patient = await requirePatient();
  const params = await searchParams;
  const notice = noticeText(single(params.notice));
  const error = errorText(single(params.error));
  const db = getDatabase();
  const [settings, bookings] = await Promise.all([loadClinicSettings(db), listBookingsForPatient(db, patient.id)]);
  const now = getClock().now();
  const upcoming = bookings.filter((b) => b.status === 'confirmed' && b.startsAt > now);
  const others = bookings.filter((b) => !upcoming.includes(b)).reverse();

  const row = (booking: BookingView, changeable: boolean) => (
    <li
      key={booking.id}
      className="card booking-list-card"
      data-testid="booking-row"
      data-booking-id={booking.id}
      data-status={booking.status}
    >
      <DateTile instant={booking.startsAt} timeZone={settings.timeZone} />
      <div className="booking-copy">
        <p className="booking-time" data-testid="booking-when">
          <SlotText instant={booking.startsAt} timeZone={settings.timeZone} />
        </p>
        <p className="booking-practitioner">
          With {booking.practitionerName} ·{' '}
          <span className={`status-pill status-${booking.status}`} data-testid="booking-status">
            {statusText(booking)}
          </span>
        </p>
      </div>
      {changeable ? (
        <div className="booking-actions">
          <Link
            href={`/bookings/${booking.id}/reschedule`}
            prefetch={false}
            className="button-secondary"
            data-testid="reschedule-link"
          >
            Reschedule
          </Link>
          <form action={cancelAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button type="submit" className="button-secondary" data-testid="cancel-booking">
              Cancel
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );

  return (
    <section className="client-page">
      <header className="page-header" data-testid="client-page-header">
        <h1>My bookings</h1>
      </header>
      {notice ? (
        <p role="status" className="notice" data-testid="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <h2>Upcoming</h2>
      {upcoming.length === 0 ? (
        <p className="card empty-state" data-testid="no-upcoming">
          You have no upcoming appointments.{' '}
          <Link href="/slots" prefetch={false} className="underline">
            Book one
          </Link>
          .
        </p>
      ) : (
        <ul className="booking-list" data-testid="upcoming-bookings">
          {upcoming.map((b) => row(b, true))}
        </ul>
      )}
      {others.length > 0 ? (
        <>
          <h2>Past and cancelled</h2>
          <ul className="booking-list" data-testid="other-bookings">
            {others.map((b) => row(b, false))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
