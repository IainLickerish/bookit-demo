export function AddToCalendarLink({ bookingId }: { bookingId: string }) {
  return (
    <a
      href={`/bookings/${bookingId}/calendar`}
      className="inline-flex min-h-11 items-center px-2 text-sm underline focus-visible:outline-2 focus-visible:outline-[#1D5C4B]"
      data-testid="add-to-calendar"
    >
      Add to calendar
    </a>
  );
}
