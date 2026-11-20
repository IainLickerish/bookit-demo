import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { formatSlot, localDateOf } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { bookAction } from '../../bookings/actions';
import { dayViewHref } from '../../day-picker';
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
  const duration = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000;
  const returnHref = dayViewHref('/slots', slot.practitionerId, localDateOf(slot.startsAt, settings.timeZone));
  const lateHours = settings.lateCancellationHours;
  return (
    <section className="mx-auto max-w-[440px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h1 className="mb-2 text-[28px] leading-tight sm:text-[32px]">Confirm your booking</h1>
      {error ? (
        <p role="alert" className="alert" data-testid="booking-error">
          {error}
        </p>
      ) : null}
      {free ? <p>Check your session details before you book.</p> : null}
      <dl className="my-6 grid gap-4 rounded-lg bg-slate-100 p-4">
        <div>
          <dt className="font-medium text-slate-700">Physiotherapist</dt>
          <dd className="mt-1 text-lg font-semibold wrap-break-word" data-testid="book-practitioner">
            {slot.practitionerName}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Date and time</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums" data-testid="book-when">
            <time dateTime={slot.startsAt.toISOString()}>{formatSlot(slot.startsAt, settings.timeZone)}</time>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Duration</dt>
          <dd className="mt-1 text-lg font-semibold" data-testid="book-duration">
            {duration} minutes
          </dd>
        </div>
      </dl>
      {free ? (
        <form action={bookAction} className="space-y-4">
          <input type="hidden" name="slotId" value={slot.id} />
          <label className="text-base">
            Phone number (optional)
            <input
              type="tel"
              name="phone"
              autoComplete="tel"
              defaultValue={patient.phone ?? ''}
              className="booking-control border-slate-500"
              data-testid="book-phone"
            />
          </label>
          {lateHours > 0 ? (
            <p data-testid="booking-cancellation-window">
              Cancelling less than {lateHours} {lateHours === 1 ? 'hour' : 'hours'} before your session counts as late.
            </p>
          ) : null}
          <button type="submit" className="button booking-control w-full font-semibold" data-testid="confirm-booking">
            Confirm booking
          </button>
        </form>
      ) : (
        <p role="status" className="alert text-base" data-testid="slot-taken">
          This time is no longer available.
        </p>
      )}
      <Link
        href={returnHref}
        prefetch={false}
        className="button-secondary booking-control mt-3 flex w-full items-center justify-center border-slate-500 text-center"
        data-testid="choose-different-time"
      >
        Choose a different time
      </Link>
    </section>
  );
}
