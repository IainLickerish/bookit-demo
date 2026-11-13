'use client';

import { useActionState, useState } from 'react';
import { blockedTimeAction, type BlockFormState } from './actions';

export function BlockForm({
  practitioners,
  timeZone,
  practitionerLabel,
  bookingWord,
}: {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  practitionerLabel: string;
  bookingWord: string;
}) {
  const initial: BlockFormState = {
    values: { practitionerId: practitioners[0]?.id ?? '', start: '', end: '', reason: '' },
  };
  const [state, action, pending] = useActionState(blockedTimeAction, initial);
  const [practitionerId, setPractitionerId] = useState(initial.values.practitionerId);
  const preview = state.preview;
  return (
    <form action={action} className="mt-6 space-y-4" aria-busy={pending} data-testid="block-form">
      {state.error ? (
        <p role="alert" className="alert" data-testid="block-error">
          {state.error}
        </p>
      ) : null}
      {preview ? (
        <>
          <h2>Check blocked time</h2>
          <dl className="space-y-2" data-testid="block-preview">
            <div>
              <dt>{practitionerLabel}</dt>
              <dd>{preview.practitionerName}</dd>
            </div>
            <div>
              <dt>Start</dt>
              <dd>{preview.start}</dd>
            </div>
            <div>
              <dt>End</dt>
              <dd>{preview.end}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{preview.timeZone}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{state.values.reason || 'No reason given.'}</dd>
            </div>
          </dl>
          <p role="status" className="notice" data-testid="block-impact">
            {preview.affected.length === 0
              ? `No confirmed ${bookingWord}s overlap this time.`
              : `${preview.affected.length} confirmed ${bookingWord}${preview.affected.length === 1 ? '' : 's'} will be cancelled.`}{' '}
            Clients cannot book any time that overlaps this block. No client emails will be sent.
          </p>
          <ul className="space-y-4" data-testid="block-affected">
            {preview.affected.map((booking) => (
              <li key={booking.id} data-testid="block-affected-booking">
                {booking.patientName}: {booking.when}, {booking.duration} minutes.
              </li>
            ))}
          </ul>
          {Object.entries(state.values).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="blockId" value={preview.blockId} />
          <input type="hidden" name="snapshot" value={preview.snapshot} />
          <div className="flex flex-wrap gap-4">
            <button className="button" name="intent" value="confirm" disabled={pending} data-testid="block-confirm">
              {pending
                ? 'Saving…'
                : preview.affected.length
                  ? 'Block time and cancel bookings'
                  : 'Confirm blocked time'}
            </button>
            <button className="button-secondary" name="intent" value="edit" disabled={pending} data-testid="block-edit">
              Change details
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Choose blocked time</h2>
          <label>
            {practitionerLabel}
            <select
              name="practitionerId"
              value={practitionerId}
              onChange={(event) => setPractitionerId(event.target.value)}
              required
              data-testid="block-practitioner"
            >
              {practitioners.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <p id="block-time-hint">
            Enter future times in {timeZone}. Times repeated or skipped when the clocks change cannot be used.
          </p>
          <label>
            Start
            <input
              name="start"
              type="datetime-local"
              defaultValue={state.values.start}
              required
              aria-describedby="block-time-hint"
              data-testid="block-start"
            />
          </label>
          <label>
            End
            <input
              name="end"
              type="datetime-local"
              defaultValue={state.values.end}
              required
              aria-describedby="block-time-hint"
              data-testid="block-end"
            />
          </label>
          <label>
            Reason (optional)
            <input
              name="reason"
              defaultValue={state.values.reason}
              maxLength={300}
              aria-describedby="block-reason-hint"
              data-testid="block-reason"
            />
          </label>
          <p id="block-reason-hint">Use a brief note, without personal or medical details.</p>
          <button
            className="button"
            name="intent"
            value="review"
            disabled={pending || practitioners.length === 0}
            data-testid="block-review"
          >
            {pending ? 'Checking…' : 'Review blocked time'}
          </button>
        </>
      )}
    </form>
  );
}
