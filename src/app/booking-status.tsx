import type { BookingView } from '@/server/bookings/queries';

export function BookingStatus({ booking }: { booking: Pick<BookingView, 'status' | 'lateCancellation'> }) {
  const label =
    booking.status === 'confirmed' ? 'Confirmed' : booking.lateCancellation ? 'Cancelled (late)' : 'Cancelled';
  return (
    <span className="status-pill" data-status={booking.status} data-testid="booking-status">
      {label}
    </span>
  );
}
