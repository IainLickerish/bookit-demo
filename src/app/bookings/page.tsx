import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { listBookingsForPatient, type BookingView } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { errorText, noticeText, single, type SearchParams } from '../messages';
import { Notice } from '../notice';
import { PageHeader } from '../page-header';
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
  const dateTile = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: settings.timeZone });

  const row = (booking: BookingView, changeable: boolean) => (
    <li
      key={booking.id}
      className="card grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-4 sm:gap-x-4"
      data-testid="booking-row"
      data-booking-id={booking.id}
      data-status={booking.status}
    >
      <div
        className="w-14 rounded-xl bg-sage px-2 py-2 text-center text-[0.8125rem] leading-snug font-semibold whitespace-pre-line text-pine tabular-nums first-line:text-xl"
        aria-hidden="true"
        data-testid="booking-date-tile"
      >
        {dateTile.format(booking.startsAt).replace(' ', '\n')}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-lg font-semibold tabular-nums" data-testid="booking-when">
            {formatSlot(booking.startsAt, settings.timeZone)}
          </p>
          <p className="text-muted">With {booking.practitionerName}</p>
        </div>
        <span className="status-pill" data-status={booking.status} data-testid="booking-status">
          {statusText(booking)}
        </span>
      </div>
      {changeable ? (
        <div className="col-span-full flex flex-wrap gap-2 sm:col-start-2">
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
    <section className="page">
      <PageHeader title="My bookings" />
      {notice ? (
        <Notice kind="notice" testId="notice">
          {notice}
        </Notice>
      ) : null}
      {error ? (
        <Notice kind="alert" testId="booking-error">
          {error}
        </Notice>
      ) : null}
      <section className="space-y-4">
        <h2>Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="card card-accent" data-testid="no-upcoming">
            You have no upcoming appointments.{' '}
            <Link href="/slots" prefetch={false} className="text-action">
              Book one
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-4" data-testid="upcoming-bookings">
            {upcoming.map((b) => row(b, true))}
          </ul>
        )}
      </section>
      {others.length > 0 ? (
        <section className="space-y-4">
          <h2>Past and cancelled</h2>
          <ul className="space-y-4" data-testid="other-bookings">
            {others.map((b) => row(b, false))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
