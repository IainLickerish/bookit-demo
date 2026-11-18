import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string) => `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  const displayedDate = formatLocalDate(view.date);
  const weekdayEnd = displayedDate.indexOf(',');
  return (
    <div className="card day-picker" data-testid="day-picker">
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
        <button type="submit" className="button-secondary" data-testid="show-slots">
          Show times
        </button>
      </form>
      <div className="day-navigation">
        {view.date > view.today ? (
          <Link href={dayLink(previous)} prefetch={false} data-testid="previous-day">
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
        <span className="shown-date" data-testid="shown-date">
          <span data-testid="shown-weekday">{displayedDate.slice(0, weekdayEnd)}</span>
          {', '}
          <span className="shown-calendar-date" data-testid="shown-calendar-date">
            {displayedDate.slice(weekdayEnd + 2)}
          </span>
          {view.date === view.today ? <span className="today-dot" aria-hidden="true" data-testid="today-dot" /> : null}
        </span>
        {view.date < view.lastDate ? (
          <Link href={dayLink(next)} prefetch={false} data-testid="next-day">
            Next day →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
