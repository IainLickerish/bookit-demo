import type { Database } from '@/db/client';
import { bookings } from '@/db/schema';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import type { Logger } from '@/lib/logger';
import { isUniqueViolation } from '../errors';
import { composeConfirmation } from '../notifications/confirmation';
import { deliverEmail, type MailSettings } from '../notifications/deliver';
import { loadClinicSettings } from '../settings';
import { findBookableSlot } from '../slots/queries';
import { findUserById } from '../users';
import { BookingError } from './errors';
import { findBookingForPatient, ONE_CONFIRMED_BOOKING_PER_SLOT, type BookingView } from './queries';
import { assertSlotBookable, normalisePhone } from './rules';

export interface BookingDependencies {
  db: Database;
  clock: Clock;
  log: Logger;
  mail: MailSettings;
}

export interface BookSlotRequest {
  patientId: string;
  slotId: string;
  phone?: string | null;
}

export async function bookSlot(deps: BookingDependencies, request: BookSlotRequest): Promise<BookingView> {
  const phone = normalisePhone(request.phone);
  const now = deps.clock.now();
  const { booking, confirmation } = await deps.db.transaction(async (tx) => {
    const settings = await loadClinicSettings(tx);
    const patient = await findUserById(tx, request.patientId);
    if (!patient || patient.role !== 'patient') {
      throw new BookingError('not_a_patient');
    }
    const slot = await findBookableSlot(tx, request.slotId);
    if (!slot) {
      throw new BookingError('slot_not_found');
    }
    assertSlotBookable(slot.startsAt, now, settings);
    const id = newId(deps.clock);
    try {
      await tx.insert(bookings).values({
        id,
        patientId: patient.id,
        slotId: slot.id,
        status: 'confirmed',
        lateCancellation: false,
        phone,
        rescheduleCount: 0,
        createdAt: now,
        updatedAt: now,
        cancelledAt: null,
      });
    } catch (error) {
      if (isUniqueViolation(error, ONE_CONFIRMED_BOOKING_PER_SLOT)) {
        throw new BookingError('slot_unavailable');
      }
      throw error;
    }
    const created = await findBookingForPatient(tx, patient.id, id);
    if (!created) {
      throw new Error('A booking inserted in this transaction could not be read back.');
    }
    // Composed inside the transaction, so a booking is only confirmed if its
    // confirmation can be written; it is sent once the booking has committed.
    return {
      booking: created,
      confirmation: composeConfirmation({ booking: created, patient, settings, from: deps.mail.from }),
    };
  });
  deps.log.info(
    {
      event: 'booking.confirmed',
      booking_id: booking.id,
      slot_id: booking.slotId,
      practitioner_id: booking.practitionerId,
      phone_given: booking.phone !== null,
    },
    'Booking confirmed',
  );
  // A failed email never undoes the booking; the patient still sees it in "My bookings".
  await deliverEmail(deps.mail, deps.log, confirmation, 'confirmation', { booking_id: booking.id });
  return booking;
}
