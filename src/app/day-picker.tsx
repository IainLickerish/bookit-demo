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
        <button type="submit" className="button-secondary" data-testid="show-slots">
          Show times
        </button>
      </form>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {view.date > view.today ? (
          <Link
            href={dayLink(previous)}
            prefetch={false}
            className="text-link justify-self-start"
            data-testid="previous-day"
          >
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
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
          <Link href={dayLink(next)} prefetch={false} className="text-link justify-self-end" data-testid="next-day">
            Next day →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
