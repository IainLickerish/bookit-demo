import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string) => `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  const day = formatLocalDate(view.date);
  const comma = day.indexOf(',');
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
        <div className="booking-action-bar" data-testid="day-action-bar">
          <button type="submit" className="button" data-testid="show-slots">
            Show times
          </button>
        </div>
      </form>
      <div className="day-navigation">
        {view.date > view.today ? (
          <Link href={dayLink(previous)} prefetch={false} data-testid="previous-day">
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
        <span className="chosen-day" data-testid="shown-date">
          <span>{day.slice(0, comma + 1)}</span> <span>{day.slice(comma + 2)}</span>
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
