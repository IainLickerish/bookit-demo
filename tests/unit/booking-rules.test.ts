import { describe, expect, it } from 'vitest';
import { BookingError, type BookingErrorCode } from '@/server/bookings/errors';
import { assertReschedulable, assertSlotBookable, isLateCancellation, normalisePhone } from '@/server/bookings/rules';

function refusal(run: () => unknown): BookingErrorCode | 'none' {
  try {
    run();
    return 'none';
  } catch (error) {
    if (error instanceof BookingError) {
      return error.code;
    }
    throw error;
  }
}

const HOUR = 3_600_000;

describe('cancellation rules (REQ-18.1-01)', () => {
  const acme = { lateCancellationHours: 24 };
  const beacon = { lateCancellationHours: 48 };
  const now = new Date('2026-10-20T11:00:00Z');
  const at = (hoursAhead: number) => new Date(now.getTime() + hoursAhead * HOUR);

  it('treats a booking starting inside the window as a late cancellation', () => {
    expect(isLateCancellation(new Date('2026-10-21T09:00:00Z'), now, acme)).toBe(true);
    expect(isLateCancellation(at(3), now, acme)).toBe(true);
    expect(isLateCancellation(at(23.99), now, acme)).toBe(true);
    expect(isLateCancellation(at(36), now, beacon)).toBe(true);
  });

  it('treats a booking at or beyond the window as an ordinary cancellation', () => {
    expect(isLateCancellation(at(24), now, acme)).toBe(false);
    expect(isLateCancellation(at(25), now, acme)).toBe(false);
    expect(isLateCancellation(at(48), now, beacon)).toBe(false);
  });

  it('refuses to cancel an appointment that has started, with status 409', () => {
    expect(refusal(() => isLateCancellation(now, now, acme))).toBe('booking_already_started');
    expect(refusal(() => isLateCancellation(at(-1), now, acme))).toBe('booking_already_started');
    expect(new BookingError('booking_already_started').status).toBe(409);
  });
});

describe('slot booking rules (REQ-18.1-01)', () => {
  const now = new Date('2026-10-20T07:00:00Z');
  const settings = { slotHorizonDays: 220 };

  it('allows a future slot up to and including the horizon', () => {
    expect(refusal(() => assertSlotBookable(new Date('2026-10-20T08:00:00Z'), now, settings))).toBe('none');
    expect(refusal(() => assertSlotBookable(new Date('2027-05-28T07:00:00Z'), now, settings))).toBe('none');
  });

  it('refuses a slot that has started or lies beyond the horizon', () => {
    expect(refusal(() => assertSlotBookable(now, now, settings))).toBe('slot_in_past');
    expect(refusal(() => assertSlotBookable(new Date('2026-10-19T08:00:00Z'), now, settings))).toBe('slot_in_past');
    expect(refusal(() => assertSlotBookable(new Date('2027-05-28T07:00:00.001Z'), now, settings))).toBe(
      'slot_beyond_horizon',
    );
  });
});

describe('reschedule rules (REQ-18.1-01)', () => {
  const now = new Date('2026-10-20T07:00:00Z');
  const settings = { maxReschedulesPerBooking: 3 };
  const booking = {
    status: 'confirmed' as const,
    slotId: 'slot-a',
    startsAt: new Date('2026-10-22T09:00:00Z'),
    rescheduleCount: 0,
  };

  it('allows moving a confirmed future booking to another slot', () => {
    expect(refusal(() => assertReschedulable(booking, 'slot-b', now, settings))).toBe('none');
    expect(refusal(() => assertReschedulable({ ...booking, rescheduleCount: 2 }, 'slot-b', now, settings))).toBe(
      'none',
    );
  });

  it('refuses after the clinic limit of reschedules', () => {
    expect(refusal(() => assertReschedulable({ ...booking, rescheduleCount: 3 }, 'slot-b', now, settings))).toBe(
      'reschedule_limit_reached',
    );
    expect(
      refusal(() =>
        assertReschedulable({ ...booking, rescheduleCount: 2 }, 'slot-b', now, {
          maxReschedulesPerBooking: 2,
        }),
      ),
    ).toBe('reschedule_limit_reached');
  });

  it('refuses cancelled, started and same-slot reschedules', () => {
    expect(refusal(() => assertReschedulable({ ...booking, status: 'cancelled' }, 'slot-b', now, settings))).toBe(
      'booking_not_active',
    );
    expect(refusal(() => assertReschedulable({ ...booking, startsAt: now }, 'slot-b', now, settings))).toBe(
      'booking_already_started',
    );
    expect(refusal(() => assertReschedulable(booking, 'slot-a', now, settings))).toBe('same_slot');
  });
});

describe('optional phone number (REQ-18.1-01)', () => {
  it('treats a blank or missing phone number as none', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });

  it('accepts common phone formats and trims them', () => {
    expect(normalisePhone(' +44 7700 900123 ')).toBe('+44 7700 900123');
    expect(normalisePhone('07700 900123')).toBe('07700 900123');
    expect(normalisePhone('(020) 7946-0018')).toBe('(020) 7946-0018');
  });

  it('refuses text that is not a phone number', () => {
    for (const bad of ['abc', '12345', '+44 7700 900123; drop table', '1'.repeat(40)]) {
      expect(refusal(() => normalisePhone(bad))).toBe('invalid_phone');
    }
  });
});
