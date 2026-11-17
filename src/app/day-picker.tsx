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
  const dayNameEnd = shownDate.indexOf(',') + 1;
  return (
    <div className="card day-picker" data-testid="day-picker">
      <form method="get" action={path} className="day-picker-form">
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
          <Link href={dayLink(previous)} prefetch={false} className="day-previous" data-testid="previous-day">
            ← Previous day
          </Link>
        ) : (
          <span className="day-previous" />
        )}
        <span className="shown-day" data-testid="shown-date">
          <span className="day-name">{shownDate.slice(0, dayNameEnd)}</span>
          {shownDate.slice(dayNameEnd)}
        </span>
        {view.date < view.lastDate ? (
          <Link href={dayLink(next)} prefetch={false} className="day-next" data-testid="next-day">
            Next day →
          </Link>
        ) : (
          <span className="day-next" />
        )}
      </div>
    </div>
  );
}
