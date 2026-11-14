'use client';

import { useActionState, useState } from 'react';
import type { ClinicSettings } from '@/server/settings';
import { SETTINGS_SAVED, settingsErrorText } from '../../messages';
import { saveSettingsAction } from './actions';

export function SettingsForm({ settings }: { settings: ClinicSettings }) {
  const [state, action, pending] = useActionState(saveSettingsAction, {});
  const [values, setValues] = useState({
    clinicName: settings.clinicName,
    timeZone: settings.timeZone,
    lateCancellationHours: String(settings.lateCancellationHours),
    includeContactInConfirmation: settings.includeContactInConfirmation,
    remindersEnabled: settings.remindersEnabled ? 'on' : 'off',
  });
  return (
    <>
      {state.saved ? (
        <p role="status" className="notice" data-testid="admin-settings-saved">
          {SETTINGS_SAVED}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="alert" data-testid="admin-settings-error">
          {settingsErrorText(state.error)}
        </p>
      ) : null}
      {/* Server actions reset forms even after validation fails. Keep entered settings for correction. */}
      <form action={action} onReset={(event) => event.preventDefault()} className="mt-6 space-y-4">
        <label>
          Clinic name
          <input
            name="clinicName"
            value={values.clinicName}
            onChange={(event) => setValues({ ...values, clinicName: event.target.value })}
            maxLength={120}
            required
            data-testid="admin-clinic-name"
          />
        </label>
        <label>
          Time zone
          <input
            name="timeZone"
            value={values.timeZone}
            onChange={(event) => setValues({ ...values, timeZone: event.target.value })}
            required
            data-testid="admin-time-zone"
          />
        </label>
        <p className="text-sm">
          Use an IANA time zone, for example Europe/London. Existing appointment times stay fixed; display and date
          filters use this zone.
        </p>
        <label>
          Late-cancellation window (hours)
          <input
            name="lateCancellationHours"
            type="number"
            min={0}
            max={336}
            step={1}
            value={values.lateCancellationHours}
            onChange={(event) => setValues({ ...values, lateCancellationHours: event.target.value })}
            required
            data-testid="admin-late-hours"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="includeContactInConfirmation"
            checked={values.includeContactInConfirmation}
            onChange={(event) => setValues({ ...values, includeContactInConfirmation: event.target.checked })}
            className="w-auto"
            data-testid="admin-include-contact"
          />
          Include contact details in confirmation emails
        </label>
        <label>
          Reminder emails
          <select
            name="remindersEnabled"
            value={values.remindersEnabled}
            onChange={(event) => setValues({ ...values, remindersEnabled: event.target.value })}
            aria-describedby="reminder-email-hint"
            data-testid="admin-reminders"
            className="min-h-12"
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
        <p id="reminder-email-hint" className="text-sm">
          Send one reminder email about 24 hours before each booking. Bookings made within 24 hours receive a reminder
          at the next check.
        </p>
        <button disabled={pending} type="submit" className="button" data-testid="admin-save-settings">
          Save settings
        </button>
      </form>
    </>
  );
}
