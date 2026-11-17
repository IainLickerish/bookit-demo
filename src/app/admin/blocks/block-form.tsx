'use client';

import { useActionState, useState } from 'react';
import { saveBlockAction } from './actions';

export function BlockForm({
  practitioners,
  timeZone,
  practitionerLabel,
}: {
  practitioners: { id: string; name: string }[];
  timeZone: string;
  practitionerLabel: string;
}) {
  const [state, action, pending] = useActionState(saveBlockAction, {});
  const [values, setValues] = useState({ practitionerId: '', startsAt: '', endsAt: '', reason: '' });
  const fieldProps = (field: keyof typeof values) => ({
    className: 'min-h-12',
    value: values[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues({ ...values, [field]: event.target.value }),
    'aria-invalid': state.field === field || undefined,
    'aria-describedby':
      [field === 'startsAt' || field === 'endsAt' ? 'block-time-hint' : '', state.field === field ? 'block-error' : '']
        .filter(Boolean)
        .join(' ') || undefined,
  });
  return (
    <form action={action} className="my-6 space-y-4" data-testid="block-form">
      {state.error ? (
        <p id="block-error" role="alert" className="alert" data-testid="block-error">
          {state.error}
        </p>
      ) : null}
      <label>
        {practitionerLabel}
        <select name="practitionerId" required {...fieldProps('practitionerId')} data-testid="block-practitioner">
          <option value="">Choose a {practitionerLabel.toLowerCase()}</option>
          {practitioners.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <p id="block-time-hint">
        Enter times in {timeZone}. Times skipped or repeated when clocks change cannot be used.
      </p>
      <label>
        Start
        <input name="startsAt" type="datetime-local" required {...fieldProps('startsAt')} data-testid="block-start" />
      </label>
      <label>
        End
        <input name="endsAt" type="datetime-local" required {...fieldProps('endsAt')} data-testid="block-end" />
      </label>
      <label>
        Reason (optional)
        <input name="reason" maxLength={500} {...fieldProps('reason')} data-testid="block-reason" />
      </label>
      <p>Only clinic staff see blocked periods and reasons. Existing bookings will stay confirmed.</p>
      <button type="submit" className="button min-h-12" disabled={pending} data-testid="block-save">
        {pending ? 'Saving blocked time…' : 'Save blocked time'}
      </button>
    </form>
  );
}
