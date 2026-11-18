import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { listBookingsForPatient, type BookingView } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { errorText, noticeText, single, type SearchParams } from '../messages';
import { cancelAction } from './actions';
import { PageHeader } from '../page-header';

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
  const dateTile = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, day: 'numeric', month: 'short' });

  const row = (booking: BookingView, changeable: boolean) => (
    <li
      key={booking.id}
      className="card flex flex-wrap items-center justify-between gap-4"
      data-testid="booking-row"
      data-booking-id={booking.id}
      data-status={booking.status}
    >
      <div className="flex min-w-0 items-start gap-4">
        <div
          aria-hidden="true"
          className="grid min-h-12 w-16 shrink-0 place-items-center rounded-xl bg-sage text-center font-semibold tabular-nums text-pine"
        >
          {dateTile.format(booking.startsAt)}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold tabular-nums" data-testid="booking-when">
            {formatSlot(booking.startsAt, settings.timeZone)}
          </p>
          <p className="mt-1 text-muted">
            With {booking.practitionerName} ·{' '}
            <span
              className={booking.status === 'confirmed' ? 'status-pill status-confirmed' : 'status-pill'}
              data-testid="booking-status"
            >
              {statusText(booking)}
            </span>
          </p>
        </div>
      </div>
      {changeable ? (
        <div className="flex flex-wrap gap-2">
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
      <PageHeader title="My bookings" />
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
        <p className="card" data-testid="no-upcoming">
          You have no upcoming appointments.{' '}
          <Link href="/slots" prefetch={false} className="quiet-link">
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
        <section className="mt-8">
          <h2>Past and cancelled</h2>
          <ul className="space-y-4" data-testid="other-bookings">
            {others.map((b) => row(b, false))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
