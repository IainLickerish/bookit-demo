import type { BookingView } from '@/server/bookings/queries';

export function bookingView(overrides: Partial<BookingView> = {}): BookingView {
  return {
    id: '019a0000-0000-7000-8000-00000000b001',
    patientId: '019a0000-0000-7000-8000-00000000a001',
    status: 'confirmed',
    lateCancellation: false,
    phone: null,
    rescheduleCount: 0,
    createdAt: new Date('2026-10-20T07:00:00Z'),
    updatedAt: new Date('2026-10-20T07:00:00Z'),
    cancelledAt: null,
    slotId: '019a0000-0000-7000-8000-00000000c001',
    startsAt: new Date('2026-10-22T09:30:00Z'),
    endsAt: new Date('2026-10-22T10:15:00Z'),
    practitionerId: '019a0000-0000-7000-8000-00000000d001',
    practitionerName: 'Pat Physio',
    ...overrides,
  };
}
