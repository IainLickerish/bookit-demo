'use client';

import { useActionState, useEffect, useRef } from 'react';
import { formatSlot } from '@/lib/time';
import { BLOCK_OUT_MESSAGES, noticeText } from '../messages';
import { saveBlockOutAction } from './block-out-actions';

interface BlockOutFormProps {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  reasonLimit: number;
}

export function BlockOutForm({ practitioners, timeZone, reasonLimit }: BlockOutFormProps) {
  const [state, formAction, pending] = useActionState(saveBlockOutAction, { attempt: 0 });
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.attempt > 0) feedback.current?.focus();
  }, [state.attempt]);

  const { saved, error, values } = state;
  const formTimeZone = state.timeZone ?? timeZone;
  const practitionerError = error === 'invalid_practitioner';
  const startError = error === 'invalid_start';
  const endError = error === 'invalid_end' || error === 'invalid_range';
  const reasonError = error === 'invalid_reason';

  return (
    <section id="block-out-time" className="mt-8 border-t border-slate-200 pt-2" tabIndex={-1}>
      <h2>Block out time</h2>
      <div ref={feedback} tabIndex={-1}>
        {error ? (
          <p id="block-out-error" role="alert" className="alert" data-testid="block-out-error">
            {BLOCK_OUT_MESSAGES[error]}
          </p>
        ) : null}
        {saved ? (
          <>
            <div role="status" className="notice" data-testid="block-out-saved">
              <p className="font-semibold">{noticeText('block_out_saved')}</p>
              <p>{saved.practitionerName}</p>
              <p>
                {formatSlot(saved.startsAt, saved.timeZone)} to {formatSlot(saved.endsAt, saved.timeZone)}
              </p>
              {saved.reason ? <p className="wrap-anywhere">{saved.reason}</p> : null}
            </div>
            {saved.conflicts.length > 0 ? (
              <div role="alert" className="attention" data-testid="block-out-warning">
                <h3 className="font-semibold">Bookings overlap this block-out</h3>
                <p>These bookings are still confirmed. Please contact the patients to arrange a new time.</p>
                <ul className="mt-2 list-disc space-y-2 pl-5">
                  {saved.conflicts.map((booking) => (
                    <li key={booking.id} data-testid="block-out-conflict">
                      <span className="block font-medium">{booking.patientName}</span>
                      <span>
                        {formatSlot(booking.startsAt, saved.timeZone)} to {formatSlot(booking.endsAt, saved.timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {practitioners.length === 0 ? (
        <p>There are no physiotherapists available to select.</p>
      ) : (
        <form key={state.attempt} action={formAction} className="max-w-xl space-y-4" data-testid="block-out-form">
          <input type="hidden" name="timeZone" value={formTimeZone} />
          <label>
            Physiotherapist
            <select
              name="practitionerId"
              defaultValue={values?.practitionerId ?? ''}
              required
              aria-invalid={practitionerError || undefined}
              aria-describedby={practitionerError ? 'block-out-error' : undefined}
              className="min-h-12 focus-visible:outline-2 focus-visible:outline-teal-700"
              data-testid="block-out-practitioner"
            >
              <option value="">Choose a physiotherapist</option>
              {practitioners.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <p id="block-out-time-zone" className="text-sm">
            Enter dates and times in the clinic’s time zone ({formTimeZone}).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="min-w-0">
              Starts
              <input
                type="datetime-local"
                name="startsAt"
                defaultValue={values?.startsAt}
                required
                aria-invalid={startError || undefined}
                aria-describedby={startError ? 'block-out-time-zone block-out-error' : 'block-out-time-zone'}
                className="min-h-12 min-w-0 focus-visible:outline-2 focus-visible:outline-teal-700"
                data-testid="block-out-start"
              />
            </label>
            <label className="min-w-0">
              Ends
              <input
                type="datetime-local"
                name="endsAt"
                defaultValue={values?.endsAt}
                required
                aria-invalid={endError || undefined}
                aria-describedby={endError ? 'block-out-time-zone block-out-error' : 'block-out-time-zone'}
                className="min-h-12 min-w-0 focus-visible:outline-2 focus-visible:outline-teal-700"
                data-testid="block-out-end"
              />
            </label>
          </div>
          <label>
            Reason (optional)
            <input
              name="reason"
              defaultValue={values?.reason}
              maxLength={reasonLimit}
              aria-invalid={reasonError || undefined}
              aria-describedby={reasonError ? 'block-out-error' : undefined}
              className="min-h-12 focus-visible:outline-2 focus-visible:outline-teal-700"
              data-testid="block-out-reason"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="button min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-60"
            data-testid="block-out-save"
          >
            {pending ? 'Saving block-out…' : 'Save block-out'}
          </button>
        </form>
      )}
    </section>
  );
}
