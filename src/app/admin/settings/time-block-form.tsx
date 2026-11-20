'use client';

import { useActionState, useEffect, useRef } from 'react';
import { TIME_BLOCK_MESSAGES } from '../../messages';
import { timeBlockAction, type TimeBlockFormState } from './time-block-actions';

const emptyFields = { practitionerId: '', startsAt: '', endsAt: '', reason: '' };
const initialState: TimeBlockFormState = { step: 'edit', fields: emptyFields };

export function TimeBlockForm({
  practitioners,
  timeZone,
  reasonLimit,
}: {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  reasonLimit: number;
}) {
  const [state, action, pending] = useActionState(timeBlockAction, initialState);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.step === 'review') reviewHeading.current?.focus();
  }, [state]);

  if (practitioners.length === 0) return <p>There are no active physiotherapists to choose from.</p>;
  const fields = state.step === 'edit' ? state.fields : emptyFields;
  return (
    <form action={action} className="mt-4 space-y-4" aria-label="Block time" aria-busy={pending}>
      {state.step === 'saved' ? (
        <p role="status" className="notice" data-testid="time-block-saved">
          {TIME_BLOCK_MESSAGES.saved}
        </p>
      ) : null}
      {state.step === 'edit' && state.error ? (
        <p role="alert" className="alert" data-testid="time-block-error">
          {state.error}
        </p>
      ) : null}
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {state.step === 'review' ? (
          <>
            <h3 ref={reviewHeading} tabIndex={-1} className="text-base font-semibold">
              Review time block
            </h3>
            {state.changed ? (
              <p role="status" className="notice" data-testid="time-block-review-changed">
                {TIME_BLOCK_MESSAGES.review_changed}
              </p>
            ) : null}
            <dl className="space-y-1 text-sm" data-testid="time-block-review">
              <div>
                <dt className="inline font-medium">Physiotherapist </dt>
                <dd className="inline">{state.practitionerName}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Start </dt>
                <dd className="inline">{state.start}</dd>
              </div>
              <div>
                <dt className="inline font-medium">End </dt>
                <dd className="inline">{state.end}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Time zone </dt>
                <dd className="inline">{state.timeZone}</dd>
              </div>
              {state.reason ? (
                <div>
                  <dt className="inline font-medium">Reason </dt>
                  <dd className="inline wrap-anywhere">{state.reason}</dd>
                </div>
              ) : null}
            </dl>
            {state.bookings.length > 0 ? (
              <section aria-labelledby="affected-bookings" data-testid="time-block-affected">
                <h4 id="affected-bookings" className="font-semibold">
                  Affected bookings
                </h4>
                <p role="alert" className="alert mt-2">
                  These bookings will stay confirmed. Contact the clients to arrange what happens next.
                </p>
                <ul className="divide-y divide-slate-300">
                  {state.bookings.map((booking) => (
                    <li key={booking.id} className="py-3 text-sm" data-testid="time-block-affected-booking">
                      <p className="font-medium">{booking.patientName}</p>
                      <p className="wrap-anywhere">{booking.patientEmail}</p>
                      {booking.phone ? <p>{booking.phone}</p> : null}
                      <p>
                        {booking.start} to {booking.end}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p data-testid="time-block-no-affected">No confirmed bookings overlap this time.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button name="intent" value="save" className="button min-h-11" data-testid="time-block-save">
                Save time block
              </button>
              <button name="intent" value="edit" className="button-secondary min-h-11" data-testid="time-block-edit">
                Edit details
              </button>
            </div>
          </>
        ) : (
          <div key={JSON.stringify(fields)} className="space-y-4">
            <p id="time-block-zone" className="text-sm">
              Enter dates and times in the clinic’s time zone ({timeZone}).
            </p>
            <label>
              Physiotherapist
              <select
                name="practitionerId"
                defaultValue={fields.practitionerId}
                required
                className="min-h-11"
                data-testid="time-block-practitioner"
              >
                <option value="" disabled>
                  Choose a physiotherapist
                </option>
                {practitioners.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                Start date and time
                <input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={fields.startsAt}
                  required
                  aria-describedby="time-block-zone"
                  className="min-h-11 min-w-0"
                  data-testid="time-block-start"
                />
              </label>
              <label>
                End date and time
                <input
                  type="datetime-local"
                  name="endsAt"
                  defaultValue={fields.endsAt}
                  required
                  aria-describedby="time-block-zone"
                  className="min-h-11 min-w-0"
                  data-testid="time-block-end"
                />
              </label>
            </div>
            <label>
              Reason (optional)
              <input
                name="reason"
                defaultValue={fields.reason}
                maxLength={reasonLimit}
                className="min-h-11"
                data-testid="time-block-reason"
              />
            </label>
            <button name="intent" value="review" className="button min-h-11" data-testid="time-block-review-button">
              Review time block
            </button>
          </div>
        )}
      </fieldset>
      <p role="status" className="text-sm">
        {pending ? 'Checking time block…' : null}
      </p>
    </form>
  );
}
