import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelAction, rescheduleAction } from '@/app/bookings/actions';
import { cancelBooking } from '@/server/bookings/cancel';
import { BookingError } from '@/server/bookings/errors';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { bookingDependencies, requirePatient } from '@/server/request-context';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/server/bookings/book', () => ({ bookSlot: vi.fn() }));
vi.mock('@/server/bookings/cancel', () => ({ cancelBooking: vi.fn() }));
vi.mock('@/server/bookings/reschedule', () => ({ rescheduleBooking: vi.fn() }));
vi.mock('@/server/request-context', () => ({ bookingDependencies: vi.fn(), requirePatient: vi.fn() }));

const bookingId = '019a0000-0000-7000-8000-00000000b001';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePatient).mockResolvedValue({ id: 'client-id' } as Awaited<ReturnType<typeof requirePatient>>);
  vi.mocked(bookingDependencies).mockResolvedValue({ log: { info: vi.fn() } } as unknown as Awaited<
    ReturnType<typeof bookingDependencies>
  >);
});

describe.each([
  { operation: 'move', action: rescheduleAction, save: rescheduleBooking, notice: 'rescheduled' },
  { operation: 'cancel', action: cancelAction, save: cancelBooking, notice: 'cancelled' },
])('calendar history after a $operation', ({ operation, action, save, notice }) => {
  it('invalidates the saved booking’s calendar route after saving and before redirecting', async () => {
    const form = new FormData();
    form.set('bookingId', bookingId);
    form.set('newSlotId', '019a0000-0000-7000-8000-00000000c001');
    // The route comes from the saved result rather than trusting the submitted ID.
    const savedId = '019a0000-0000-7000-8000-00000000b002';
    vi.mocked(rescheduleBooking).mockResolvedValue({ id: savedId } as Awaited<ReturnType<typeof rescheduleBooking>>);
    vi.mocked(cancelBooking).mockResolvedValue({ booking: { id: savedId }, late: false } as Awaited<
      ReturnType<typeof cancelBooking>
    >);
    await action(form);
    expect(save).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(`/bookings/${savedId}/calendar`);
    expect(redirect).toHaveBeenCalledWith(`/bookings?notice=${notice}`);
    expect(vi.mocked(save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidatePath).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(revalidatePath).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the existing summary when the operation is refused', async () => {
    const form = new FormData();
    form.set('bookingId', bookingId);
    const refused = new BookingError('booking_not_found');
    vi.mocked(rescheduleBooking).mockRejectedValue(refused);
    vi.mocked(cancelBooking).mockRejectedValue(refused);
    await action(form);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      operation === 'move'
        ? `/bookings/${bookingId}/reschedule?error=booking_not_found`
        : '/bookings?error=booking_not_found',
    );
  });
});
