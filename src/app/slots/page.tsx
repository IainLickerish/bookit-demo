import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadDayView } from '@/server/slots/day-view';
import { DayPicker } from '../day-picker';
import { single, type SearchParams } from '../messages';

export default async function SlotsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePatient();
  const params = await searchParams;
  const view = await loadDayView(getDatabase(), getClock(), {
    practitionerId: single(params.practitioner),
    date: single(params.date),
  });
  return (
    <section>
      <h1>Book an appointment</h1>
      <DayPicker view={view} path="/slots" />
      {view.slots.length === 0 ? (
        <p data-testid="no-slots">No free times on this day. Try another day.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="slot-list">
          {view.slots.map((slot) => (
            <li key={slot.id}>
              <Link
                href={`/book/${slot.id}`}
                prefetch={false}
                className="button-secondary block text-center"
                data-testid="slot-link"
                data-slot-id={slot.id}
                data-starts-at={slot.startsAt.toISOString()}
              >
                {formatSlot(slot.startsAt, view.settings.timeZone)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
