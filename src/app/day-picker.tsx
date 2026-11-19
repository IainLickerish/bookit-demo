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
    <div className="card mb-6 space-y-4">
      <form
        method="get"
        action={path}
        className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      >
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
        <button type="submit" className="button-secondary" data-testid="show-slots">
          Show times
        </button>
      </form>
      <div className="day-navigation border-t border-line pt-4">
        {view.date > view.today ? (
          <Link href={dayLink(previous)} prefetch={false} className="justify-self-start" data-testid="previous-day">
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
        <time
          dateTime={view.date}
          className="chosen-day"
          data-today={view.date === view.today ? true : undefined}
          data-testid="shown-date"
        >
          {formatLocalDate(view.date)}
        </time>
        {view.date < view.lastDate ? (
          <Link href={dayLink(next)} prefetch={false} className="justify-self-end" data-testid="next-day">
            Next day →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
