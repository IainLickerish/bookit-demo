import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requirePatient } from '@/server/request-context';
import { loadDayView } from '@/server/slots/day-view';
import { DayPicker } from '../day-picker';
import { single, type SearchParams } from '../messages';
import { SlotList } from '../slot-list';

export default async function SlotsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePatient();
  const params = await searchParams;
  const view = await loadDayView(getDatabase(), getClock(), {
    practitionerId: single(params.practitioner),
    date: single(params.date),
  });
  return (
    <section className="mx-auto max-w-[720px]">
      <h1 className="mb-2 text-[28px] sm:text-[32px]">Book a session</h1>
      <p className="mb-6">Choose your physiotherapist, day and time.</p>
      <DayPicker view={view} path="/slots" forNewBooking />
      <SlotList
        slots={view.slots}
        timeZone={view.settings.timeZone}
        renderChoice={(slot, label) => (
          <Link
            href={`/book/${slot.id}`}
            prefetch={false}
            className="button-secondary booking-control flex items-center justify-center border-slate-500 text-center text-lg font-semibold tabular-nums"
            data-testid="slot-link"
            data-slot-id={slot.id}
            data-starts-at={slot.startsAt.toISOString()}
          >
            <time dateTime={slot.startsAt.toISOString()}>{label}</time>
          </Link>
        )}
      />
    </section>
  );
}
