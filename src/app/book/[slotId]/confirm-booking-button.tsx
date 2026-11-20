'use client';

import { useFormStatus } from 'react-dom';

export function ConfirmBookingButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="button w-full justify-center"
      disabled={pending}
      aria-live="polite"
      data-testid="confirm-booking"
    >
      {pending ? 'Confirming booking…' : 'Confirm booking'}
    </button>
  );
}
