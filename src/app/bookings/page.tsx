import { cookies } from 'next/headers';
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
  const confirmationId = (await cookies()).get('bookit_booking_confirmation')?.value;
  const confirmedBooking = ['booked', 'rescheduled'].includes(single(params.notice) ?? '')
    ? bookings.find((booking) => booking.id === confirmationId && booking.status === 'confirmed')
    : undefined;
  const now = getClock().now();
  const upcoming = bookings.filter((b) => b.status === 'confirmed' && b.startsAt > now);
  const others = bookings.filter((b) => !upcoming.includes(b)).reverse();

  const row = (booking: BookingView, changeable: boolean) => (
    <li
      key={booking.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4"
      data-testid="booking-row"
      data-booking-id={booking.id}
      data-status={booking.status}
    >
      <div>
        <p className="font-medium" data-testid="booking-when">
          {formatSlot(booking.startsAt, settings.timeZone)}
        </p>
        <p className="text-sm text-slate-600">
          With {booking.practitionerName} · <span data-testid="booking-status">{statusText(booking)}</span>
        </p>
      </div>
      {booking.status === 'confirmed' ? (
        <div className="flex flex-wrap gap-2">
          <a href={`/bookings/${booking.id}/calendar`} className="button-secondary" data-testid="add-to-calendar">
            Add to calendar
          </a>
          {changeable ? (
            <>
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
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );

  return (
    <section>
      <h1>My bookings</h1>
      {notice ? (
        <div className="notice">
          <p role="status" data-testid="notice">
            {notice}
          </p>
          {confirmedBooking ? (
            <div data-testid="booking-confirmation">
              <p>
                {settings.clinicName} · {confirmedBooking.practitionerName}
              </p>
              <p>
                {formatSlot(confirmedBooking.startsAt, settings.timeZone)} ·{' '}
                {(confirmedBooking.endsAt.getTime() - confirmedBooking.startsAt.getTime()) / 60_000} minutes
              </p>
              <a
                href={`/bookings/${confirmedBooking.id}/calendar`}
                className="button-secondary"
                data-testid="confirmation-add-to-calendar"
              >
                Add to calendar
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <p className="mb-4" data-testid="calendar-help">
        Open the calendar file in Google, Outlook or Apple Calendar. If you move or cancel, update your calendar too. My
        bookings always shows your current booking.
      </p>
      <h2>Upcoming</h2>
      {upcoming.length === 0 ? (
        <p data-testid="no-upcoming">
          You have no upcoming appointments.{' '}
          <Link href="/slots" prefetch={false} className="underline">
            Book one
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2" data-testid="upcoming-bookings">
          {upcoming.map((b) => row(b, true))}
        </ul>
      )}
      {others.length > 0 ? (
        <>
          <h2>Past and cancelled</h2>
          <ul className="space-y-2" data-testid="other-bookings">
            {others.map((b) => row(b, false))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
