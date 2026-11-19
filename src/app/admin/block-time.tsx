'use client';

import { useActionState, useEffect, useRef } from 'react';
import { formatSlot } from '@/lib/time';
import { BLOCK_ERRORS, BLOCK_REVIEW_CHANGED, noticeText } from '../messages';
import { blockTimeAction, type BlockDetails, type BlockState } from './block-time-action';

const initialState: BlockState = { step: 'edit', fields: { practitionerId: '', start: '', end: '', reason: '' } };

function PeriodDetails({ details }: { details: BlockDetails }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-[auto_1fr]">
      <dt className="font-medium">Physiotherapist</dt>
      <dd>{details.practitionerName}</dd>
      <dt className="font-medium">Start</dt>
      <dd>{formatSlot(details.startsAt, details.timeZone)}</dd>
      <dt className="font-medium">End</dt>
      <dd>{formatSlot(details.endsAt, details.timeZone)}</dd>
      {details.reason ? (
        <>
          <dt className="font-medium">Reason</dt>
          <dd className="wrap-anywhere">{details.reason}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function BlockTime({
  practitioners,
  timeZone,
  reasonLimit,
}: {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  reasonLimit: number;
}) {
  const [state, action, pending] = useActionState(blockTimeAction, initialState);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state !== initialState) resultHeading.current?.focus();
  }, [state]);

  return (
    <div className="my-2 max-w-xl rounded border border-slate-300 bg-white p-4">
      {state.step === 'edit' ? (
        <form action={action} key={JSON.stringify(state.fields)}>
          <h2 ref={resultHeading} tabIndex={-1} className="mt-0">
            Choose the time to block
          </h2>
          {state.error ? (
            <p className="alert" role="alert" data-testid="block-time-error">
              {BLOCK_ERRORS[state.error]}
            </p>
          ) : null}
          <fieldset disabled={pending} className="space-y-4">
            <label>
              Physiotherapist
              <select
                name="practitionerId"
                defaultValue={state.fields.practitionerId}
                className="min-h-11"
                required
                data-testid="block-practitioner"
              >
                <option value="">Choose a physiotherapist</option>
                {practitioners.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <p id="block-time-zone" className="text-sm">
              Use the clinic’s time zone ({timeZone}). If the clocks go back, a repeated time means its first
              occurrence.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="min-w-0">
                Start
                <input
                  type="datetime-local"
                  name="start"
                  defaultValue={state.fields.start}
                  aria-describedby="block-time-zone"
                  className="min-h-11 min-w-0"
                  required
                  data-testid="block-start"
                />
              </label>
              <label className="min-w-0">
                End
                <input
                  type="datetime-local"
                  name="end"
                  defaultValue={state.fields.end}
                  aria-describedby="block-time-zone"
                  className="min-h-11 min-w-0"
                  required
                  data-testid="block-end"
                />
              </label>
            </div>
            <label>
              Reason (optional)
              <input
                name="reason"
                defaultValue={state.fields.reason}
                maxLength={reasonLimit}
                className="min-h-11"
                data-testid="block-reason"
              />
            </label>
            <button type="submit" name="intent" value="review" className="button min-h-11" data-testid="block-review">
              {pending ? 'Checking bookings…' : 'Review block'}
            </button>
          </fieldset>
        </form>
      ) : state.step === 'review' ? (
        <form action={action}>
          <h2 ref={resultHeading} tabIndex={-1} className="mt-0">
            Review time to block
          </h2>
          {state.changed ? (
            <p role="alert" className="alert" data-testid="block-review-changed">
              {BLOCK_REVIEW_CHANGED}
            </p>
          ) : null}
          <PeriodDetails details={state.review} />
          {state.review.affected.length > 0 ? (
            <div
              role="region"
              aria-labelledby="block-warning-heading"
              className="my-4 rounded border border-amber-200 bg-[#FDF3E2] px-4 py-3 text-[#92400E]"
              data-testid="block-affected-bookings"
            >
              <h3 id="block-warning-heading" className="font-semibold">
                Confirmed bookings in this time
              </h3>
              <p className="mt-1">
                These sessions will stay confirmed. Contact the clients to rearrange their sessions.
              </p>
              <ul className="mt-3 space-y-3">
                {state.review.affected.map(({ id, patientName, startsAt, endsAt }) => (
                  <li key={id} className="wrap-anywhere" data-testid="block-affected-booking">
                    <p className="font-medium">{patientName}</p>
                    <p>
                      {formatSlot(startsAt, state.review.timeZone)} to {formatSlot(endsAt, state.review.timeZone)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="my-4" data-testid="block-no-affected">
              No confirmed bookings in this time.
            </p>
          )}
          <fieldset disabled={pending} className="flex flex-wrap gap-3">
            {Object.entries(state.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="reviewId" value={state.review.id} />
            <input type="hidden" name="reviewVersion" value={state.review.version} />
            <button type="submit" name="intent" value="save" className="button min-h-11" data-testid="block-save">
              {pending ? 'Working…' : 'Save block'}
            </button>
            <button
              type="submit"
              name="intent"
              value="edit"
              className="button-secondary min-h-11"
              data-testid="block-edit"
            >
              Edit block
            </button>
          </fieldset>
        </form>
      ) : (
        <>
          <h2 ref={resultHeading} tabIndex={-1} role="status" className="notice mt-0" data-testid="block-saved">
            {noticeText('time_blocked')}
          </h2>
          <PeriodDetails details={state.details} />
          <form action={action} className="mt-4">
            <button
              type="submit"
              name="intent"
              value="new"
              className="button-secondary min-h-11"
              disabled={pending}
              data-testid="block-more"
            >
              Block more time
            </button>
          </form>
        </>
      )}
    </div>
  );
}
