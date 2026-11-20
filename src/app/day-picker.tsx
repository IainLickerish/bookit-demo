import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string) => `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  return (
    <div className="card space-y-4">
      <form method="get" action={path} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label>
          Practitioner
          <select name="practitioner" defaultValue={practitionerId} data-testid="practitioner-select">
            {view.practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            name="date"
            defaultValue={view.date}
            min={view.today}
            max={view.lastDate}
            data-testid="date-input"
          />
        </label>
        <button type="submit" className="button" data-testid="show-slots">
          Show times
        </button>
      </form>
      <div className="grid grid-cols-2 items-center gap-2 border-t border-line pt-4 text-[0.9375rem] sm:grid-cols-[1fr_auto_1fr]">
        {view.date > view.today ? (
          <Link
            href={dayLink(previous)}
            prefetch={false}
            className="tap-link justify-self-start"
            data-testid="previous-day"
          >
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
        <span
          className="col-span-2 col-start-1 row-start-1 justify-self-center rounded-xl bg-stone px-3 py-2 text-center font-medium ring-1 ring-pine tabular-nums sm:col-span-1 sm:col-start-2"
          data-testid="shown-date"
        >
          {formatLocalDate(view.date)}
        </span>
        {view.date < view.lastDate ? (
          <Link
            href={dayLink(next)}
            prefetch={false}
            className="tap-link justify-self-end text-right"
            data-testid="next-day"
          >
            Next day →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
