import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string) => `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  const [weekday, calendarDate] = formatLocalDate(view.date).split(', ');
  return (
    <div className="card space-y-6">
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
        <div className="booking-action">
          <button type="submit" className="button w-full" data-testid="show-slots">
            Show times
          </button>
        </div>
      </form>
      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        {view.date > view.today ? (
          <Link
            href={dayLink(previous)}
            prefetch={false}
            className="text-link col-start-1 row-start-2 justify-self-start sm:row-start-1"
            data-testid="previous-day"
          >
            ← Previous day
          </Link>
        ) : null}
        <time
          dateTime={view.date}
          className={view.date === view.today ? 'day-tile day-tile--today' : 'day-tile'}
          data-testid="shown-date"
        >
          <span className="block text-[0.8125rem] text-muted">
            {weekday}
            {', '}
          </span>
          <span className="block">{calendarDate}</span>
        </time>
        {view.date < view.lastDate ? (
          <Link
            href={dayLink(next)}
            prefetch={false}
            className="text-link col-start-2 row-start-2 justify-self-end sm:col-start-3 sm:row-start-1"
            data-testid="next-day"
          >
            Next day →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
