import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { requirePatient } from '@/server/request-context';
import { loadDayView } from '@/server/slots/day-view';
import { DayPicker } from '../day-picker';
import { single, type SearchParams } from '../messages';
import { PageHeading } from '../page-heading';

export default async function SlotsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePatient();
  const params = await searchParams;
  const view = await loadDayView(getDatabase(), getClock(), {
    practitionerId: single(params.practitioner),
    date: single(params.date),
  });
  return (
    <section className="page-shell" data-testid="booking-page">
      <PageHeading title="Book an appointment" />
      <DayPicker view={view} path="/slots" />
      <div className="card" data-testid="times-card">
        {view.slots.length === 0 ? (
          <p data-testid="no-slots">No free times on this day. Try another day.</p>
        ) : (
          <ul className="time-grid" data-testid="slot-list">
            {view.slots.map((slot) => (
              <li key={slot.id}>
                <Link
                  href={`/book/${slot.id}`}
                  prefetch={false}
                  className="button-secondary time-pill"
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
      </div>
    </section>
  );
}
