import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CALENDAR_MESSAGES } from '@/app/messages';
import { getDatabase } from '@/db/client';
import { calendarDetails } from '@/lib/calendar';
import { getClock } from '@/lib/clock';
import { findBookingForPatient } from '@/server/bookings/queries';
import { requirePatient } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { CopyCalendarDetails } from './copy-calendar-details';

export default async function CalendarPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const patient = await requirePatient();
  const { bookingId } = await params;
  const db = getDatabase();
  const [booking, settings] = await Promise.all([
    findBookingForPatient(db, patient.id, bookingId),
    loadClinicSettings(db),
  ]);
  if (!booking || booking.status !== 'confirmed' || booking.startsAt <= getClock().now()) {
    notFound();
  }
  const details = calendarDetails({
    clinicName: settings.clinicName,
    timeZone: settings.timeZone,
    practitionerName: booking.practitionerName,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
  });
  return (
    <section className="calendar-panel max-w-xl space-y-6">
      <h1 data-testid="calendar-title">Add to calendar</h1>
      <p>
        Create an event in Google Calendar, Outlook or Apple Calendar. Use the title, start, end and time zone below,
        then save your event.
      </p>
      <p className="notice notice-sage" data-testid="calendar-update-help">
        {CALENDAR_MESSAGES.manualUpdate}
      </p>
      <CopyCalendarDetails details={details} />
      <Link
        href="/bookings"
        prefetch={false}
        className="button-secondary button-secondary-pine"
        data-testid="calendar-back"
      >
        Back to My bookings
      </Link>
    </section>
  );
}
