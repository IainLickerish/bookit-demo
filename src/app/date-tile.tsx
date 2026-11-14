/** Decorative extract of a date already written in full alongside it. */
export function DateTile({ instant, timeZone }: { instant: Date; timeZone: string }) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).formatToParts(instant);
  return (
    <span className="date-tile" aria-hidden="true" data-testid="booking-date-tile">
      <span className="date-tile-day" data-testid="date-tile-day">
        {parts.find((part) => part.type === 'day')?.value}
      </span>
      <span data-testid="date-tile-month">{parts.find((part) => part.type === 'month')?.value}</span>
    </span>
  );
}
