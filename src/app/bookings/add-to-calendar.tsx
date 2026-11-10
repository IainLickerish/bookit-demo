import {
  calendarFilePath,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalendarBooking,
  type CalendarClinic,
} from '@/server/calendar/appointment';

/** "Add to calendar" choices for one confirmed booking. Works without JavaScript. */
export function AddToCalendar({ booking, clinic }: { booking: CalendarBooking; clinic: CalendarClinic }) {
  return (
    <details className="relative" data-testid="add-to-calendar">
      <summary className="button-secondary cursor-pointer list-none">Add to calendar</summary>
      <ul className="absolute right-0 z-10 mt-1 w-56 space-y-1 rounded border border-slate-200 bg-white p-2 text-sm shadow">
        <li>
          <a
            href={googleCalendarUrl(booking, clinic)}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded px-2 py-1 hover:bg-slate-100"
            data-testid="calendar-google"
          >
            Google Calendar
          </a>
        </li>
        <li>
          <a
            href={outlookCalendarUrl(booking, clinic)}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded px-2 py-1 hover:bg-slate-100"
            data-testid="calendar-outlook"
          >
            Outlook (web)
          </a>
        </li>
        <li>
          <a
            href={calendarFilePath(booking.id)}
            download
            className="block rounded px-2 py-1 hover:bg-slate-100"
            data-testid="calendar-file"
          >
            Apple Calendar, Outlook app or other (.ics file)
          </a>
        </li>
      </ul>
    </details>
  );
}
