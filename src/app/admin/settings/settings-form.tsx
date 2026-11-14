'use client';

import { useActionState, useEffect, useRef } from 'react';
import { SETTINGS_MESSAGES } from '@/app/messages';
import { saveSettingsAction, type SettingsFormState, type SettingsFormValues } from './actions';

export function SettingsForm({ values }: { values: SettingsFormValues }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(saveSettingsAction, {
    values,
    fieldErrors: {},
  });
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  return (
    <form action={action} noValidate className="mt-6 space-y-4" aria-busy={pending}>
      {state.saved && !pending ? (
        <p role="status" className="notice" data-testid="admin-settings-saved">
          {SETTINGS_MESSAGES.saved}
        </p>
      ) : null}
      {state.error ? (
        <p ref={errorRef} tabIndex={-1} role="alert" className="alert" data-testid="admin-settings-error">
          {state.error}
        </p>
      ) : null}
      <div>
        <label htmlFor="clinic-name">Clinic name</label>
        <input
          id="clinic-name"
          name="clinicName"
          defaultValue={state.values.clinicName}
          maxLength={120}
          required
          aria-invalid={Boolean(state.fieldErrors.clinicName)}
          aria-describedby={state.fieldErrors.clinicName ? 'clinic-name-error' : undefined}
          data-testid="admin-clinic-name"
        />
        {state.fieldErrors.clinicName ? (
          <p id="clinic-name-error" className="field-error" data-testid="admin-clinic-name-error">
            <span aria-hidden="true">⚠ </span>
            {state.fieldErrors.clinicName}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="time-zone">Time zone</label>
        <input
          id="time-zone"
          name="timeZone"
          defaultValue={state.values.timeZone}
          required
          aria-invalid={Boolean(state.fieldErrors.timeZone)}
          aria-describedby={`time-zone-hint${state.fieldErrors.timeZone ? ' time-zone-error' : ''}`}
          data-testid="admin-time-zone"
        />
        <p id="time-zone-hint" className="text-sm">
          Use an IANA time zone, for example Europe/London. Existing appointment times stay fixed; display and date
          filters use this zone.
        </p>
        {state.fieldErrors.timeZone ? (
          <p id="time-zone-error" className="field-error" data-testid="admin-time-zone-error">
            <span aria-hidden="true">⚠ </span>
            {state.fieldErrors.timeZone}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="late-hours">Late-cancellation window (hours)</label>
        <input
          id="late-hours"
          name="lateCancellationHours"
          type="number"
          min={0}
          max={336}
          step={1}
          defaultValue={state.values.lateCancellationHours}
          required
          aria-invalid={Boolean(state.fieldErrors.lateCancellationHours)}
          aria-describedby={state.fieldErrors.lateCancellationHours ? 'late-hours-error' : undefined}
          data-testid="admin-late-hours"
        />
        {state.fieldErrors.lateCancellationHours ? (
          <p id="late-hours-error" className="field-error" data-testid="admin-late-hours-error">
            <span aria-hidden="true">⚠ </span>
            {state.fieldErrors.lateCancellationHours}
          </p>
        ) : null}
      </div>
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          name="includeContactInConfirmation"
          defaultChecked={state.values.includeContactInConfirmation}
          className="w-auto"
          data-testid="admin-include-contact"
        />
        Include contact details in confirmation emails
      </label>
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          name="remindersEnabled"
          defaultChecked={state.values.remindersEnabled}
          className="w-auto"
          aria-describedby="reminders-hint"
          data-testid="admin-reminders-enabled"
        />
        Send reminder emails
      </label>
      <p id="reminders-hint" data-testid="reminders-hint">
        Send one reminder 23 to 24 hours before each booked time. Reminders use UK time and never include a phone
        number. Turning this off stops future reminders for this clinic.
      </p>
      <button type="submit" className="button" disabled={pending} data-testid="admin-save-settings">
        {pending ? 'Saving settings…' : 'Save settings'}
      </button>
    </form>
  );
}
