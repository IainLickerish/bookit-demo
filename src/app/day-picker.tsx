import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string) => `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  const [weekday, ...dateParts] = formatLocalDate(view.date).split(' ');
  const isToday = view.date === view.today;
  return (
    <div className="card space-y-6">
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
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-line pt-4">
        {view.date > view.today ? (
          <Link
            href={dayLink(previous)}
            prefetch={false}
            className="text-action justify-self-start"
            data-testid="previous-day"
          >
            ← Previous day
          </Link>
        ) : (
          <span />
        )}
        <time
          dateTime={view.date}
          aria-current={isToday ? 'date' : undefined}
          className="day-current"
          data-testid="shown-date"
        >
          <span className="flex items-center gap-2">
            {isToday ? <span className="size-1.5 rounded-full bg-clay" aria-hidden="true" /> : null}
            {weekday}
          </span>{' '}
          <span className="tabular-nums">{dateParts.join(' ')}</span>
        </time>
        {view.date < view.lastDate ? (
          <Link
            href={dayLink(next)}
            prefetch={false}
            className="text-action justify-self-end text-right"
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
