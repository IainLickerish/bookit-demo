'use client';

import { useActionState } from 'react';
import type { BlockField } from '@/server/admin/time-block-input';
import { FeedbackIcon } from '../../feedback-icon';
import { BLOCK_MESSAGES } from '../../messages';
import { saveBlockAction, type BlockFormState } from './actions';

const initialState: BlockFormState = {
  values: { practitionerId: '', start: '', end: '', reason: '' },
  errors: {},
};

export function BlockForm({
  practitioners,
  practitionerLabel,
  timeZone,
}: {
  practitioners: { id: string; name: string }[];
  practitionerLabel: string;
  timeZone: string;
}) {
  const [state, action, pending] = useActionState(saveBlockAction, initialState);
  const error = (field: BlockField) =>
    state.errors[field] ? (
      <p id={`${field}-error`} className="field-error" data-testid={`block-${field}-error`}>
        <FeedbackIcon kind="attention" />
        {BLOCK_MESSAGES[state.errors[field]]}
      </p>
    ) : null;
  const description = (field: BlockField) => (state.errors[field] ? `${field}-error` : undefined);
  return (
    <form action={action} noValidate className="space-y-4" data-testid="block-form">
      {Object.keys(state.errors).length ? (
        <p role="alert" className="alert" data-testid="block-error">
          <FeedbackIcon kind="attention" />
          {BLOCK_MESSAGES.invalid}
        </p>
      ) : null}
      <div>
        <label htmlFor="block-practitioner">{practitionerLabel}</label>
        <select
          key={state.values.practitionerId}
          id="block-practitioner"
          name="practitionerId"
          defaultValue={state.values.practitionerId}
          required
          aria-invalid={!!state.errors.practitionerId}
          aria-describedby={description('practitionerId')}
          data-testid="block-practitioner"
        >
          <option value="">Choose a {practitionerLabel.toLowerCase()}</option>
          {practitioners.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        {error('practitionerId')}
      </div>
      <p id="block-zone" className="text-sm">
        Enter dates and 24-hour times in {timeZone}. A booking may start when the block ends. Times in a repeated or
        skipped hour cannot be used.
      </p>
      {(['start', 'end'] as const).map((field) => (
        <div key={field}>
          <label htmlFor={`block-${field}`}>{field === 'start' ? 'Start' : 'End'}</label>
          <input
            id={`block-${field}`}
            type="datetime-local"
            name={field}
            defaultValue={state.values[field]}
            required
            aria-invalid={!!state.errors[field]}
            aria-describedby={[description(field), 'block-zone'].filter(Boolean).join(' ')}
            data-testid={`block-${field}`}
          />
          {error(field)}
        </div>
      ))}
      <div>
        <label htmlFor="block-reason">Reason (optional)</label>
        <input
          id="block-reason"
          name="reason"
          defaultValue={state.values.reason}
          maxLength={500}
          aria-invalid={!!state.errors.reason}
          aria-describedby={description('reason')}
          data-testid="block-reason"
        />
        {error('reason')}
      </div>
      <button type="submit" className="button" disabled={pending} data-testid="block-save">
        {pending ? 'Saving blocked time…' : 'Save blocked time'}
      </button>
    </form>
  );
}
