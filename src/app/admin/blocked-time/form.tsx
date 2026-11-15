'use client';

import { useActionState } from 'react';
import { saveBlockedPeriodAction, type BlockFormState } from './actions';

export function BlockTimeForm({
  practitioners,
  practitionerLabel,
  timeZone,
}: {
  practitioners: { id: string; name: string }[];
  practitionerLabel: string;
  timeZone: string;
}) {
  const initial: BlockFormState = { values: { practitionerId: '', start: '', end: '', reason: '' }, errors: {} };
  const [state, action, pending] = useActionState(saveBlockedPeriodAction, initial);
  return (
    <form action={action} className="my-6 space-y-4" aria-busy={pending} noValidate>
      {state.message ? (
        <p role="alert" className="alert" data-testid="block-error">
          {state.message}
        </p>
      ) : null}
      <label>
        {practitionerLabel}
        <select
          name="practitionerId"
          defaultValue={state.values.practitionerId}
          required
          aria-invalid={!!state.errors.practitionerId}
          aria-describedby="block-practitioner-error"
          data-testid="block-practitioner"
        >
          <option value="">Choose a {practitionerLabel.toLowerCase()}</option>
          {practitioners.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <span id="block-practitioner-error">{state.errors.practitionerId}</span>
      </label>
      <p id="block-zone">
        Enter dates and times in {timeZone}. When clocks go back, a repeated time uses its first occurrence.
      </p>
      <label>
        Start
        <input
          type="datetime-local"
          name="start"
          defaultValue={state.values.start}
          required
          aria-invalid={!!state.errors.start}
          aria-describedby="block-zone block-start-error"
          data-testid="block-start"
        />
        <span id="block-start-error">{state.errors.start}</span>
      </label>
      <label>
        End
        <input
          type="datetime-local"
          name="end"
          defaultValue={state.values.end}
          required
          aria-invalid={!!state.errors.end}
          aria-describedby="block-zone block-end-error"
          data-testid="block-end"
        />
        <span id="block-end-error" data-testid="block-end-error">
          {state.errors.end}
        </span>
      </label>
      <label>
        Reason (optional)
        <input
          name="reason"
          defaultValue={state.values.reason}
          maxLength={500}
          aria-invalid={!!state.errors.reason}
          aria-describedby="block-reason-error"
          data-testid="block-reason"
        />
        <span id="block-reason-error">{state.errors.reason}</span>
      </label>
      <button type="submit" className="button" disabled={pending} data-testid="block-save">
        {pending ? 'Saving blocked period…' : 'Save blocked period'}
      </button>
    </form>
  );
}
