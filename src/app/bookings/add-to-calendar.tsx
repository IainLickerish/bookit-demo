import { BOOKING_CALENDAR_FILENAME } from '@/server/bookings/calendar';

export function AddToCalendar({ bookingId }: { bookingId: string }) {
  return (
    <a
      href={`/bookings/${bookingId}/calendar.ics`}
      download={BOOKING_CALENDAR_FILENAME}
      className="button-secondary inline-flex min-h-11 items-center"
      data-testid="add-to-calendar"
    >
      Add to calendar
    </a>
  );
}
