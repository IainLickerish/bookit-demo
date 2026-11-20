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
import { Notice } from '../../../notice';
import { PageHeader } from '../../../page-header';
import { SlotList } from '../../../slot-list';
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
    <section className="page">
      <PageHeader title="Reschedule your appointment">
        <p>
          Currently booked:{' '}
          <span className="font-semibold text-ink tabular-nums" data-testid="current-when">
            {formatSlot(booking.startsAt, view.settings.timeZone)}
          </span>{' '}
          with {booking.practitionerName}.
        </p>
      </PageHeader>
      {error ? (
        <Notice kind="alert" testId="booking-error">
          {error}
        </Notice>
      ) : null}
      {!changeable ? (
        <Notice kind="alert" testId="not-reschedulable">
          This booking can no longer be rescheduled online.
        </Notice>
      ) : remaining === 0 ? (
        <Notice kind="alert" testId="reschedule-limit">
          This booking has been rescheduled as many times as the clinic allows. Please contact the clinic.
        </Notice>
      ) : (
        <>
          <div className="space-y-4">
            <p className="text-muted" data-testid="reschedules-remaining">
              You can reschedule this booking {remaining} more {remaining === 1 ? 'time' : 'times'}.
            </p>
            <DayPicker view={view} path={path} />
          </div>
          <SlotList
            slots={choices}
            timeZone={view.settings.timeZone}
            renderChoice={(slot, label) => (
              <form action={rescheduleAction}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <input type="hidden" name="newSlotId" value={slot.id} />
                <button
                  type="submit"
                  className="button-secondary w-full border-pine tabular-nums"
                  data-testid="reschedule-to"
                  data-slot-id={slot.id}
                  data-starts-at={slot.startsAt.toISOString()}
                >
                  {label}
                </button>
              </form>
            )}
          />
        </>
      )}
      <Link href="/bookings" prefetch={false} className="text-action">
        Back to my bookings
      </Link>
    </section>
  );
}
