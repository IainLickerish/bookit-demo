import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string) => `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  const shownDate = formatLocalDate(view.date);
  const dateBreak = shownDate.indexOf(',') + 1;
  return (
    <div className="day-picker">
      <form method="get" action={path} className="card day-filters" data-testid="day-filters">
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
        <div className="mobile-action-bar" data-testid="day-action-bar">
          <button type="submit" className="button" data-testid="show-slots">
            Show times
          </button>
        </div>
      </form>
      <div className="day-navigation" data-testid="day-navigation">
        {view.date > view.today ? (
          <Link href={dayLink(previous)} prefetch={false} data-testid="previous-day">
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
        <span className="chosen-day" data-testid="shown-date" aria-current="date">
          <span>{shownDate.slice(0, dateBreak)}</span> <span>{shownDate.slice(dateBreak).trimStart()}</span>
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
