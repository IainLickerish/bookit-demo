import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import { settingsErrorText, type SearchParams } from '../../messages';
import { SettingsForm } from './settings-form';

export default async function AdminSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const [settings, params] = await Promise.all([loadClinicSettings(getDatabase()), searchParams]);
  return (
    <section>
      <h1>Clinic settings</h1>
      <p>
        <Link href="/admin" prefetch={false} className="underline">
          Back to bookings
        </Link>
      </p>
      {params.error ? (
        <p role="alert" className="alert" data-testid="admin-settings-error">
          {settingsErrorText(params.error)}
        </p>
      ) : null}
      <SettingsForm settings={settings} saved={params.saved === '1'} />
    </section>
  );
}
