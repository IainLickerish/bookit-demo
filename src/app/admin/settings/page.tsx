import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import type { SearchParams } from '../../messages';
import { PageHeader } from '../../page-header';
import { saveSettingsAction } from './actions';

export default async function AdminSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const [settings, params] = await Promise.all([loadClinicSettings(getDatabase()), searchParams]);
  return (
    <section className="page-wide">
      <PageHeader title="Clinic settings" />
      <div className="card max-w-[720px] space-y-4">
        <p>
          <Link href="/admin" prefetch={false} className="tap-link">
            Back to bookings
          </Link>
        </p>
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
        <form action={saveSettingsAction} className="space-y-4">
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
          <div className="space-y-2">
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
            <p id="time-zone-hint" className="text-[0.8125rem] text-muted">
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
          <label className="flex min-h-11 items-center gap-2">
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
