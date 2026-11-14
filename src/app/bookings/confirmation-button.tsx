'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { BOOKING_MESSAGES } from '../messages';

/** Keep a second press from queuing another action while the first is saving. */
export function ConfirmationButton({ children, testId }: { children: ReactNode; testId: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button type="submit" className="button" disabled={pending} aria-busy={pending} data-testid={testId}>
        {pending ? BOOKING_MESSAGES.saving : children}
      </button>
      <span role="status" className="sr-only">
        {pending ? BOOKING_MESSAGES.saving : ''}
      </span>
    </>
  );
}
