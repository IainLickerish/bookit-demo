'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { TimeBlockFields } from '@/server/admin/time-blocks';
import { TIME_BLOCK_ERRORS } from '../messages';
import type { TimeBlockFormError } from './time-block-actions';

interface TimeBlockFormProps {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  reasonLimit: number;
  saveAction: (previous: TimeBlockFormError | null, form: FormData) => Promise<TimeBlockFormError>;
}

export function TimeBlockForm({ practitioners, timeZone, reasonLimit, saveAction }: TimeBlockFormProps) {
  const [state, action, pending] = useActionState(saveAction, null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    const invalidField = form.current?.elements.namedItem(state.field);
    if (invalidField instanceof HTMLElement) invalidField.focus();
  }, [state]);

  function fieldProps(field: keyof TimeBlockFields) {
    return {
      name: field,
      defaultValue: state?.values[field] ?? '',
      'aria-invalid': state?.field === field || undefined,
      'aria-describedby': state?.field === field ? 'time-block-error' : undefined,
    };
  }

  return (
    <details open={state ? true : undefined} className="my-4">
      <summary
        className="w-fit cursor-pointer rounded border border-slate-300 bg-white px-4 py-3 text-sm font-medium"
        data-testid="admin-block-time"
      >
        Block out time
      </summary>
      <form
        key={state?.attempt}
        ref={form}
        action={action}
        className="mt-4 max-w-lg space-y-4"
        data-testid="time-block-form"
      >
        {state ? (
          <p role="alert" className="alert" id="time-block-error" data-testid="time-block-error">
            {TIME_BLOCK_ERRORS[state.error]}
          </p>
        ) : null}
        <p className="text-sm">Use the clinic’s time zone ({timeZone}). Existing bookings will stay confirmed.</p>
        <label>
          Physiotherapist
          <select {...fieldProps('practitionerId')} className="min-h-11" required data-testid="time-block-practitioner">
            <option value="">Choose a physiotherapist</option>
            {practitioners.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="min-w-0">
            Start date and time
            <input
              {...fieldProps('startsAt')}
              className="min-h-11"
              type="datetime-local"
              required
              data-testid="time-block-start"
            />
          </label>
          <label className="min-w-0">
            End date and time
            <input
              {...fieldProps('endsAt')}
              className="min-h-11"
              type="datetime-local"
              required
              data-testid="time-block-end"
            />
          </label>
        </div>
        <label>
          Reason (optional)
          <input
            {...fieldProps('reason')}
            className="min-h-11"
            maxLength={reasonLimit}
            data-testid="time-block-reason"
          />
        </label>
        <button
          type="submit"
          className="button min-h-11 disabled:opacity-60"
          disabled={pending}
          data-testid="save-time-block"
        >
          {pending ? 'Saving time block…' : 'Save time block'}
        </button>
      </form>
    </details>
  );
}
