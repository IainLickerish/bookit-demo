import Link from 'next/link';
import { addDaysToLocalDate, formatLocalDate } from '@/lib/time';
import type { DayView } from '@/server/slots/day-view';

export function dayViewHref(path: string, practitionerId: string, date: string) {
  return `${path}?${new URLSearchParams({ practitioner: practitionerId, date }).toString()}`;
}

/** Practitioner and date controls for a page that lists one day's slots. */
export function DayPicker({
  view,
  path,
  forNewBooking = false,
}: {
  view: DayView;
  path: string;
  forNewBooking?: boolean;
}) {
  const practitionerId = view.practitioner?.id ?? '';
  const dayLink = (date: string, label: string, testId: string) => (
    <Link
      href={dayViewHref(path, practitionerId, date)}
      prefetch={false}
      className={forNewBooking ? 'button-secondary booking-control border-slate-500 text-center' : undefined}
      data-testid={testId}
    >
      {label}
      {forNewBooking ? (
        <time dateTime={date} className="mt-1 block font-semibold tabular-nums">
          {formatLocalDate(date)}
        </time>
      ) : null}
    </Link>
  );
  const previousLink =
    view.date > view.today &&
    dayLink(addDaysToLocalDate(view.date, -1), forNewBooking ? 'Previous day' : '← Previous day', 'previous-day');
  const nextLink =
    view.date < view.lastDate &&
    dayLink(addDaysToLocalDate(view.date, 1), forNewBooking ? 'Next day' : 'Next day →', 'next-day');
  const shownDate = formatLocalDate(view.date);
  const fieldClass = forNewBooking ? 'booking-control min-w-0 border-slate-500' : undefined;
  return (
    <div className="mb-6 space-y-4">
      <form
        method="get"
        action={path}
        className={
          forNewBooking
            ? 'grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end'
            : 'grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end'
        }
      >
        <label className={forNewBooking ? 'text-base' : undefined}>
          {forNewBooking ? 'Physiotherapist' : 'Practitioner'}
          <select
            name="practitioner"
            defaultValue={practitionerId}
            className={fieldClass}
            data-testid="practitioner-select"
          >
            {view.practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={forNewBooking ? 'text-base' : undefined}>
          Date
          <input
            type="date"
            name="date"
            defaultValue={view.date}
            min={view.today}
            max={view.lastDate}
            className={fieldClass}
            data-testid="date-input"
          />
        </label>
        <button
          type="submit"
          className={forNewBooking ? 'button-secondary booking-control border-slate-500' : 'button-secondary'}
          data-testid="show-slots"
        >
          Show times
        </button>
      </form>
      {forNewBooking ? (
        <>
          <p>You can book up to {view.settings.slotHorizonDays} days ahead.</p>
          <div className="grid auto-cols-fr grid-flow-col gap-3">
            {previousLink}
            {nextLink}
          </div>
          <h2 className="mt-6 mb-0 text-xl leading-snug" aria-live="polite" aria-atomic="true">
            Available times for{' '}
            <time dateTime={view.date} data-testid="shown-date">
              {shownDate}
            </time>
          </h2>
        </>
      ) : (
        <div className="flex items-center justify-between text-sm">
          {previousLink || <span />}
          <span className="font-medium" data-testid="shown-date">
            {shownDate}
          </span>
          {nextLink || <span />}
        </div>
      )}
    </div>
  );
}
