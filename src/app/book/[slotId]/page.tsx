import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { findBookableSlot, isSlotFree } from '@/server/slots/queries';
import { bookAction } from '../../bookings/actions';
import { errorText, single, type SearchParams } from '../../messages';
import { Notice } from '../../notice';
import { PageHeader } from '../../page-header';

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
    <section className={`page page-narrow${free ? ' with-booking-action' : ''}`}>
      <div className="card card-accent space-y-6">
        <PageHeader title="Confirm your booking" />
        {error ? (
          <Notice kind="alert" testId="booking-error">
            {error}
          </Notice>
        ) : null}
        <dl className="space-y-2 rounded-xl bg-sage p-4">
          <div>
            <dt className="inline font-medium">With: </dt>
            <dd className="inline" data-testid="book-practitioner">
              {slot.practitionerName}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">When: </dt>
            <dd className="inline tabular-nums" data-testid="book-when">
              {formatSlot(slot.startsAt, settings.timeZone)} ({settings.sessionMinutes} minutes)
            </dd>
          </div>
        </dl>
        {free ? (
          <form action={bookAction} className="space-y-4">
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
            <div className="booking-action">
              <button type="submit" className="button w-full" data-testid="confirm-booking">
                Confirm booking
              </button>
            </div>
          </form>
        ) : (
          <p className="text-muted" data-testid="slot-taken">
            This time is no longer available.
          </p>
        )}
        <Link href="/slots" prefetch={false} className="text-action">
          Choose a different time
        </Link>
      </div>
    </section>
  );
}
