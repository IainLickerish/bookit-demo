'use client';

export function AddToCalendar({ bookingId }: { bookingId: string }) {
  return (
    <a
      href={`/bookings/${bookingId}/calendar.ics`}
      download
      onClick={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
      className="button-secondary inline-flex min-h-11 items-center"
      data-testid="add-to-calendar"
    >
      Add to calendar
    </a>
  );
}
