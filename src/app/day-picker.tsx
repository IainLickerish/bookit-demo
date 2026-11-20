import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

export function dayViewHref(path: string, practitionerId: string, date: string): string {
  return `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
}

export function DayPicker({
  view,
  path,
  practitionerLabel = 'Practitioner',
}: {
  view: DayView;
  path: string;
  practitionerLabel?: string;
}) {
  const practitionerId = view.practitioner?.id ?? '';
  return (
    <form method="get" action={path} className="day-picker grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label>
        {practitionerLabel}
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
  );
}

export function DayNavigation({ view, path }: { view: DayView; path: string }) {
  const practitionerId = view.practitioner?.id ?? '';
  const previous = addDaysToLocalDate(view.date, -1);
  const next = addDaysToLocalDate(view.date, 1);
  return (
    <nav aria-label="Choose another day" className="day-navigation">
      {view.date > view.today ? (
        <Link href={dayViewHref(path, practitionerId, previous)} prefetch={false} data-testid="previous-day">
          <span aria-hidden="true">← </span>Previous day
        </Link>
      ) : (
        <span />
      )}
      <span className="day-navigation-date font-medium" data-testid="shown-date" role="status">
        {formatLocalDate(view.date)}
      </span>
      {view.date < view.lastDate ? (
        <Link href={dayViewHref(path, practitionerId, next)} prefetch={false} data-testid="next-day">
          Next day<span aria-hidden="true"> →</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
