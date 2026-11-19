import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { listBookingsForPatient, type BookingView } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
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
  const tileDate = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, day: 'numeric', month: 'short' });

  const row = (booking: BookingView, changeable: boolean) => (
    <li
      key={booking.id}
      className="card space-y-4"
      data-testid="booking-row"
      data-booking-id={booking.id}
      data-status={booking.status}
    >
      <div className="flex items-start gap-4">
        <div className="booking-date" aria-hidden="true">
          {tileDate.formatToParts(booking.startsAt).map(({ type, value }) =>
            type === 'day' || type === 'month' ? (
              <span key={type} className={type === 'day' ? 'text-lg font-semibold' : 'text-[0.8125rem]'}>
                {value}
              </span>
            ) : null,
          )}
        </div>
        <div className="grid min-w-0 grow items-start gap-2 min-[24rem]:grid-cols-[minmax(0,1fr)_auto]">
          <p className="text-lg leading-tight font-semibold tabular-nums" data-testid="booking-when">
            {formatSlot(booking.startsAt, settings.timeZone)}
          </p>
          <p className="text-muted min-[24rem]:col-span-2">With {booking.practitionerName}</p>
          <span
            className={`status-pill justify-self-end min-[24rem]:col-start-2 min-[24rem]:row-start-1${booking.status === 'confirmed' ? '' : ' status-pill--cancelled'}`}
            data-testid="booking-status"
          >
            {statusText(booking)}
          </span>
        </div>
      </div>
      {changeable ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
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
    <section>
      <h1 className="page-heading">My bookings</h1>
      {notice ? (
        <p role="status" className="notice mb-4" data-testid="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert mb-4" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <h2 className="mb-4">Upcoming</h2>
      {upcoming.length === 0 ? (
        <p className="card" data-testid="no-upcoming">
          You have no upcoming appointments.{' '}
          <Link href="/slots" prefetch={false} className="text-link">
            Book one
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-4" data-testid="upcoming-bookings">
          {upcoming.map((b) => row(b, true))}
        </ul>
      )}
      {others.length > 0 ? (
        <>
          <h2 className="mt-8 mb-4">Past and cancelled</h2>
          <ul className="space-y-4" data-testid="other-bookings">
            {others.map((b) => row(b, false))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
