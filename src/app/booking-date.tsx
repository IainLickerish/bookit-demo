/** A decorative date tile beside the full, accessible booking time. */
export function BookingDate({ when, timeZone }: { when: Date; timeZone: string }) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).formatToParts(when);
  return (
    <span className="booking-date" aria-hidden="true" data-testid="booking-date">
      <span className="booking-date-day">{parts.find((part) => part.type === 'day')?.value}</span>
      <span className="booking-date-month">{parts.find((part) => part.type === 'month')?.value}</span>
    </span>
  );
}
