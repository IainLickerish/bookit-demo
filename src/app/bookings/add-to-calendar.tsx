import { calendarLinks } from '@/server/bookings/calendar';
import type { BookingView } from '@/server/bookings/queries';
import type { ClinicSettings } from '@/server/settings';

export function AddToCalendar({ booking, settings }: { booking: BookingView; settings: ClinicSettings }) {
  const links = calendarLinks(booking, settings);
  return (
    <details data-testid="add-to-calendar">
      <summary className="button-secondary min-h-11 cursor-pointer content-center">Add to calendar</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={links.google}
          target="_blank"
          rel="noreferrer"
          className="button-secondary min-h-11 content-center"
          data-testid="calendar-google"
        >
          Google Calendar
        </a>
        <a
          href={links.outlook}
          target="_blank"
          rel="noreferrer"
          className="button-secondary min-h-11 content-center"
          data-testid="calendar-outlook"
        >
          Outlook
        </a>
        <a
          href={`/bookings/${booking.id}/calendar`}
          download
          className="button-secondary min-h-11 content-center"
          data-testid="calendar-download"
        >
          Apple Calendar or calendar file
        </a>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Save the event in your calendar. After moving a booking, check that your calendar shows the new time. Remove
        cancelled bookings from your calendar.
      </p>
    </details>
  );
}
