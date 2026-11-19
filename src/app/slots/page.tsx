import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requirePatient } from '@/server/request-context';
import { loadDayView } from '@/server/slots/day-view';
import { DayPicker } from '../day-picker';
import { single, type SearchParams } from '../messages';
import { SlotList } from '../slot-list';
import { PageHeader } from '../page-header';

export default async function SlotsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePatient();
  const params = await searchParams;
  const view = await loadDayView(getDatabase(), getClock(), {
    practitionerId: single(params.practitioner),
    date: single(params.date),
  });
  return (
    <section>
      <PageHeader title="Book an appointment" />
      <DayPicker view={view} path="/slots" />
      <SlotList
        slots={view.slots}
        timeZone={view.settings.timeZone}
        renderChoice={(slot, label) => (
          <Link
            href={`/book/${slot.id}`}
            prefetch={false}
            className="button-secondary w-full tabular-nums"
            data-testid="slot-link"
            data-slot-id={slot.id}
            data-starts-at={slot.startsAt.toISOString()}
          >
            {label}
          </Link>
        )}
      />
    </section>
  );
}
