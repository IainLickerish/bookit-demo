import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import type { SearchParams } from '../../messages';
import { saveSettingsAction } from './actions';

export default async function AdminSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const [settings, params] = await Promise.all([loadClinicSettings(getDatabase()), searchParams]);
  return (
    <section className="client-page">
      <header className="page-header">
        <h1>Clinic settings</h1>
        <p className="page-links">
          <Link href="/admin" prefetch={false} data-testid="admin-back-to-bookings">
            Back to bookings
          </Link>
        </p>
      </header>
      <div className="card" data-testid="admin-settings-card">
        {params.saved === '1' ? (
          <p role="status" className="notice" data-testid="admin-settings-saved">
            Clinic settings saved.
          </p>
        ) : null}
        {params.error ? (
          <p role="alert" className="alert" data-testid="admin-settings-error">
            {params.error === 'invalid'
              ? 'Enter a clinic name, a valid IANA time zone and a whole number of hours from 0 to 336.'
              : 'Settings could not be saved. Please try again.'}
          </p>
        ) : null}
        <form action={saveSettingsAction} className="form-stack" data-testid="admin-settings-form">
          <label>
            Clinic name
            <input
              name="clinicName"
              defaultValue={settings.clinicName}
              maxLength={120}
              required
              data-testid="admin-clinic-name"
            />
          </label>
          <div>
            <label>
              Time zone
              <input
                name="timeZone"
                defaultValue={settings.timeZone}
                required
                aria-describedby="time-zone-hint"
                data-testid="admin-time-zone"
              />
            </label>
            <p className="field-hint" id="time-zone-hint">
              Use an IANA time zone, for example Europe/London. Existing appointment times stay fixed; display and date
              filters use this zone.
            </p>
          </div>
          <label>
            Late-cancellation window (hours)
            <input
              name="lateCancellationHours"
              type="number"
              min={0}
              max={336}
              step={1}
              defaultValue={settings.lateCancellationHours}
              required
              data-testid="admin-late-hours"
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              name="includeContactInConfirmation"
              defaultChecked={settings.includeContactInConfirmation}
              data-testid="admin-include-contact"
            />
            Include contact details in confirmation emails
          </label>
          <button type="submit" className="button" data-testid="admin-save-settings">
            Save settings
          </button>
        </form>
      </div>
    </section>
  );
}
