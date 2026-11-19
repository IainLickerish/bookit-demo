import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import type { SearchParams } from '../../messages';
import { saveSettingsAction } from './actions';
import { PageHeader } from '../../page-header';

export default async function AdminSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const [settings, params] = await Promise.all([loadClinicSettings(getDatabase()), searchParams]);
  return (
    <section>
      <PageHeader title="Clinic settings">
        <Link href="/admin" prefetch={false} data-testid="admin-settings-back">
          Back to bookings
        </Link>
      </PageHeader>
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
      <form action={saveSettingsAction} className="card space-y-4">
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
        <p id="time-zone-hint" className="-mt-2 text-[0.8125rem] text-muted">
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
            defaultValue={settings.lateCancellationHours}
            required
            data-testid="admin-late-hours"
          />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center gap-3">
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
    </section>
  );
}
