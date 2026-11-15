'use server';

import { redirect } from 'next/navigation';
import type { Logger } from '@/lib/logger';
import { bookSlot } from '@/server/bookings/book';
import { cancelBooking } from '@/server/bookings/cancel';
import { BookingError, type BookingErrorCode } from '@/server/bookings/errors';
import { isUuid } from '@/server/bookings/queries';
import { rescheduleBooking } from '@/server/bookings/reschedule';
import { withoutQueryDetails } from '@/server/errors';
import { bookingDependencies, requirePatient } from '@/server/request-context';

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** The code of a refused booking operation; anything else is rethrown. */
function refusalCode(error: unknown, log: Logger, operation: string): BookingErrorCode {
  if (error instanceof BookingError) {
    log.info(
      { event: 'booking.refused', operation, code: error.code, status: error.status },
      'Booking operation refused',
    );
    return error.code;
  }
  throw withoutQueryDetails(error);
}

export async function bookAction(formData: FormData): Promise<void> {
  const patient = await requirePatient();
  const deps = await bookingDependencies();
  const slotId = formText(formData, 'slotId');
  let destination: string;
  try {
    await bookSlot(deps, {
      patientId: patient.id,
      slotId,
      phone: formText(formData, 'phone'),
    });
    destination = '/bookings?notice=booked';
  } catch (error) {
    const code = refusalCode(error, deps.log, 'book');
    destination = isUuid(slotId) ? `/book/${slotId}?error=${code}` : `/slots?error=${code}`;
  }
  redirect(destination);
}

export async function cancelAction(formData: FormData): Promise<void> {
  const patient = await requirePatient();
  const deps = await bookingDependencies();
  const bookingId = formText(formData, 'bookingId');
  const expectedSlotId = formText(formData, 'expectedSlotId');
  const expectedLate = formText(formData, 'expectedLate');
  let destination: string;
  try {
    if (!isUuid(expectedSlotId) || !['true', 'false'].includes(expectedLate)) throw new BookingError('review_required');
    const result = await cancelBooking(deps, {
      patientId: patient.id,
      bookingId,
      expectedSlotId,
      expectedLate: expectedLate === 'true',
    });
    destination = result.late ? '/bookings?notice=cancelled_late' : '/bookings?notice=cancelled';
  } catch (error) {
    const code = refusalCode(error, deps.log, 'cancel');
    destination = isUuid(bookingId) ? `/bookings/${bookingId}/cancel?error=${code}` : `/bookings?error=${code}`;
  }
  redirect(destination);
}

export async function rescheduleAction(formData: FormData): Promise<void> {
  const patient = await requirePatient();
  const deps = await bookingDependencies();
  const bookingId = formText(formData, 'bookingId');
  const expectedSlotId = formText(formData, 'expectedSlotId');
  let destination: string;
  try {
    if (!isUuid(expectedSlotId)) throw new BookingError('review_required');
    await rescheduleBooking(deps, {
      patientId: patient.id,
      bookingId,
      newSlotId: formText(formData, 'newSlotId'),
      expectedSlotId,
    });
    destination = '/bookings?notice=rescheduled';
  } catch (error) {
    const code = refusalCode(error, deps.log, 'reschedule');
    destination = isUuid(bookingId) ? `/bookings/${bookingId}/reschedule?error=${code}` : `/bookings?error=${code}`;
  }
  redirect(destination);
}
