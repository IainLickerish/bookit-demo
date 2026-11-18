'use client';

import { useActionState, useState } from 'react';
import { timeBlockErrorText } from '@/server/admin/time-block-input';
import { noticeText } from '../messages';
import { saveTimeBlockAction } from './time-block-actions';

export function TimeBlockForm({
  practitioners,
  timeZone,
  practitionerLabel,
  returnQuery,
}: {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  practitionerLabel: string;
  returnQuery?: string;
}) {
  const [state, action, pending] = useActionState(saveTimeBlockAction, {});
  const [values, setValues] = useState({ practitionerId: '', start: '', end: '', reason: '' });
  const fieldError = (field: string) => state.error === field || (field === 'end' && state.error === 'range');
  return (
    <>
      {state.saved ? (
        <p role="status" className="notice" data-testid="time-block-saved">
          {noticeText('time_block_saved')}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="alert" id="time-block-error" data-testid="time-block-error">
          {timeBlockErrorText(state.error, practitionerLabel)}
        </p>
      ) : null}
      <form action={action} noValidate className="my-6 grid gap-4 sm:grid-cols-2" data-testid="time-block-form">
        {returnQuery !== undefined ? <input type="hidden" name="returnQuery" value={returnQuery} /> : null}
        <label>
          {practitionerLabel}
          <select
            name="practitionerId"
            value={values.practitionerId}
            onChange={(event) => setValues({ ...values, practitionerId: event.target.value })}
            required
            aria-invalid={fieldError('practitioner')}
            aria-describedby={fieldError('practitioner') ? 'time-block-error' : undefined}
            data-testid="time-block-practitioner"
          >
            <option value="">Choose a {practitionerLabel.toLowerCase()}</option>
            {practitioners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <p className="self-end text-sm" id="time-block-zone">
          Times are in {timeZone}. Use a different time if the clocks change and it is skipped or repeated.
        </p>
        {(['start', 'end'] as const).map((field) => (
          <label key={field}>
            {field === 'start' ? 'Start' : 'End'} ({timeZone})
            <input
              type="datetime-local"
              name={field}
              value={values[field]}
              onChange={(event) => setValues({ ...values, [field]: event.target.value })}
              required
              aria-invalid={fieldError(field)}
              aria-describedby={fieldError(field) ? 'time-block-error time-block-zone' : 'time-block-zone'}
              data-testid={`time-block-${field}`}
            />
          </label>
        ))}
        <label className="sm:col-span-2">
          Reason (optional)
          <input
            name="reason"
            value={values.reason}
            onChange={(event) => setValues({ ...values, reason: event.target.value })}
            maxLength={500}
            aria-invalid={fieldError('reason')}
            aria-describedby={fieldError('reason') ? 'time-block-error' : 'time-block-reason-hint'}
            data-testid="time-block-reason"
          />
          <span className="mt-1 block text-sm" id="time-block-reason-hint">
            Up to 500 characters. Only clinic staff can see this.
          </span>
        </label>
        <div>
          <button type="submit" className="button" disabled={pending} data-testid="time-block-save">
            {pending ? 'Saving block…' : 'Save block'}
          </button>
        </div>
      </form>
    </>
  );
}
