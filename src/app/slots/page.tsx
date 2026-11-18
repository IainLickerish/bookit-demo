import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadDayView } from '@/server/slots/day-view';
import { PageHeader } from '../page-header';
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
      <PageHeader>Book an appointment</PageHeader>
      <DayPicker view={view} path="/slots" />
      {view.slots.length === 0 ? (
        <p className="empty-state" data-testid="no-slots">
          No free times on this day. Try another day.
        </p>
      ) : (
        <ul className="slot-grid" data-testid="slot-list">
          {view.slots.map((slot) => (
            <li key={slot.id}>
              <Link
                href={`/book/${slot.id}`}
                prefetch={false}
                className="button-secondary slot-time"
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
