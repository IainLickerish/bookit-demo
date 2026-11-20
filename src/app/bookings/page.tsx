import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { listBookingsForPatient, type BookingView } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { BookingStatus } from '../booking-status';
import { errorText, noticeText, single, type SearchParams } from '../messages';
import { PageHeader } from '../page-header';
import { cancelAction } from './actions';

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
      className="card space-y-4"
      data-testid="booking-row"
      data-booking-id={booking.id}
      data-status={booking.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p
            className="rounded-xl bg-sage px-3 py-2 text-lg leading-snug font-semibold tabular-nums"
            data-testid="booking-when"
          >
            {formatSlot(booking.startsAt, settings.timeZone)}
          </p>
          <p className="text-muted">With {booking.practitionerName}</p>
        </div>
        <BookingStatus booking={booking} />
      </div>
      {changeable ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
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
      <div className="space-y-8">
        {notice || error ? (
          <div className="space-y-2">
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
          </div>
        ) : null}
        <div className="space-y-4">
          <h2>Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="card" data-testid="no-upcoming">
              You have no upcoming appointments.{' '}
              <Link href="/slots" prefetch={false} className="tap-link">
                Book one
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-4" data-testid="upcoming-bookings">
              {upcoming.map((b) => row(b, true))}
            </ul>
          )}
        </div>
        {others.length > 0 ? (
          <div className="space-y-4">
            <h2>Past and cancelled</h2>
            <ul className="space-y-4" data-testid="other-bookings">
              {others.map((b) => row(b, false))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
