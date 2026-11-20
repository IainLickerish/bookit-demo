import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requirePatient } from '@/server/request-context';
import { loadDayView } from '@/server/slots/day-view';
import { DayNavigation, DayPicker } from '../day-picker';
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
    <section className="booking-flow">
      <h1>Book a session</h1>
      <p className="mb-6">Choose a physiotherapist and a date to see free times.</p>
      <DayPicker
        key={`${view.practitioner?.id ?? ''}:${view.date}`}
        view={view}
        path="/slots"
        practitionerLabel="Physiotherapist"
      />
      <p className="mt-2 text-sm">You can book up to {view.settings.slotHorizonDays} days ahead.</p>
      <section aria-labelledby="free-times" className="mt-8 space-y-4 border-t border-[#E6E1D8] pt-4">
        <h2 id="free-times" className="m-0 text-[1.375rem]">
          {view.practitioner ? `Free times with ${view.practitioner.name}` : 'Free times'}
        </h2>
        <nav aria-label="Choose another day" className="day-navigation">
          <DayNavigation view={view} path="/slots" announceDate />
        </nav>
        <SlotList
          slots={view.slots}
          timeZone={view.settings.timeZone}
          emptyState={
            <p className="empty-times" role="status" data-testid="no-slots">
              No free times on this day. Choose another date and select Show times.
            </p>
          }
          renderChoice={(slot, label) => (
            <Link
              href={`/book/${slot.id}`}
              prefetch={false}
              className="button-secondary w-full justify-center text-center tabular-nums"
              data-testid="slot-link"
              data-slot-id={slot.id}
              data-starts-at={slot.startsAt.toISOString()}
            >
              {label}
            </Link>
          )}
        />
      </section>
    </section>
  );
}
