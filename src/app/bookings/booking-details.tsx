import { formatSlot } from '@/lib/time';
import { clinicWords } from '@/lib/booking-paths';

export function BookingDetails({
  booking,
  timeZone,
  prefix,
}: {
  booking: { startsAt: Date; endsAt: Date; practitionerName: string };
  timeZone: string;
  prefix: string;
}) {
  return (
    <dl className="mb-6 space-y-2">
      <div>
        <dt>{clinicWords().practitioner}</dt>
        <dd data-testid={`${prefix}-practitioner`}>{booking.practitionerName}</dd>
      </div>
      <div>
        <dt>When</dt>
        <dd data-testid={`${prefix}-when`}>
          {formatSlot(booking.startsAt, timeZone)} ({timeZone})
        </dd>
      </div>
      <div>
        <dt>Duration</dt>
        <dd data-testid={`${prefix}-duration`}>
          {(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes
        </dd>
      </div>
    </dl>
  );
}
