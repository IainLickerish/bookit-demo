import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot, localDateOf } from '@/lib/time';
import { findBookingForPatient } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { loadDayView } from '@/server/slots/day-view';
import { DayPicker } from '../../../day-picker';
import { errorText, single, type SearchParams } from '../../../messages';
import { rescheduleAction } from '../../actions';

export default async function ReschedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: SearchParams;
}) {
  const patient = await requirePatient();
  const { bookingId } = await params;
  const query = await searchParams;
  const db = getDatabase();
  const clock = getClock();
  const booking = await findBookingForPatient(db, patient.id, bookingId);
  if (!booking) {
    notFound();
  }
  const settings = await loadClinicSettings(db);
  const view = await loadDayView(db, clock, {
    practitionerId: single(query.practitioner) ?? booking.practitionerId,
    date: single(query.date) ?? localDateOf(booking.startsAt, settings.timeZone),
  });
  const error = errorText(single(query.error));
  const remaining = Math.max(0, view.settings.maxReschedulesPerBooking - booking.rescheduleCount);
  const changeable = booking.status === 'confirmed' && booking.startsAt > clock.now();
  const choices = view.slots.filter((s) => s.id !== booking.slotId);
  const path = `/bookings/${booking.id}/reschedule`;

  return (
    <section>
      <h1>Reschedule your appointment</h1>
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      <p className="mb-2">
        Currently booked:{' '}
        <span className="font-medium" data-testid="current-when">
          {formatSlot(booking.startsAt, view.settings.timeZone)}
        </span>{' '}
        with {booking.practitionerName}.
      </p>
      {!changeable ? (
        <p className="alert" data-testid="not-reschedulable">
          This booking can no longer be rescheduled online.
        </p>
      ) : remaining === 0 ? (
        <p className="alert" data-testid="reschedule-limit">
          This booking has been rescheduled as many times as the clinic allows. Please contact the clinic.
        </p>
      ) : (
        <>
          <p className="mb-6 text-sm text-slate-600" data-testid="reschedules-remaining">
            You can reschedule this booking {remaining} more {remaining === 1 ? 'time' : 'times'}.
          </p>
          <DayPicker view={view} path={path} />
          {choices.length === 0 ? (
            <p data-testid="no-slots">No free times on this day. Try another day.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="slot-list">
              {choices.map((slot) => (
                <li key={slot.id}>
                  <form action={rescheduleAction}>
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="newSlotId" value={slot.id} />
                    <button
                      type="submit"
                      className="button-secondary w-full"
                      data-testid="reschedule-to"
                      data-slot-id={slot.id}
                      data-starts-at={slot.startsAt.toISOString()}
                    >
                      {formatSlot(slot.startsAt, view.settings.timeZone)}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-6 text-sm">
        <Link href="/bookings" prefetch={false} className="underline">
          Back to my bookings
        </Link>
      </p>
    </section>
  );
}
