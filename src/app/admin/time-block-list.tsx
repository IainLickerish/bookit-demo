import { formatSlot } from '@/lib/time';
import type { listTimeBlocks } from '@/server/admin/time-blocks';

export function TimeBlockList({
  blocks,
  timeZone,
}: {
  blocks: Awaited<ReturnType<typeof listTimeBlocks>>['blocks'];
  timeZone: string;
}) {
  if (!blocks.length)
    return <p data-testid="time-block-empty">No time blocks saved. Use the form above to block out time.</p>;
  return (
    <ul className="space-y-6" data-testid="time-block-list">
      {blocks.map((block) => (
        <li key={block.id} className="border-t pt-4" data-testid="time-block">
          <h3 className="font-semibold">{block.practitionerName}</h3>
          <p className="tabular-nums">
            {formatSlot(block.startsAt, timeZone)} to {formatSlot(block.endsAt, timeZone)} ({timeZone})
          </p>
          {block.reason ? <p data-testid="time-block-saved-reason">Reason: {block.reason}</p> : null}
          {block.affectedBookings.length ? (
            <>
              <p role="status" className="alert mt-3" data-testid="time-block-warning">
                {block.affectedBookings.length} existing{' '}
                {block.affectedBookings.length === 1 ? 'booking overlaps' : 'bookings overlap'} this block. Contact the
                clients to arrange another time. These bookings have not been cancelled.
              </p>
              <ul className="space-y-3">
                {block.affectedBookings.map((booking) => (
                  <li key={booking.id} data-testid="time-block-affected-booking">
                    <p className="font-medium">{booking.patientName}</p>
                    <p>
                      {booking.practitionerName}: {formatSlot(booking.startsAt, timeZone)} to{' '}
                      {formatSlot(booking.endsAt, timeZone)} ({timeZone})
                    </p>
                    <p className="break-words">
                      Email: {booking.email}. Phone: {booking.phone ?? 'Not provided'}.
                    </p>
                    <p className="text-sm break-words">Booking reference: {booking.id}. Confirmed.</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2" data-testid="time-block-no-conflicts">
              No confirmed bookings overlap this block.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
