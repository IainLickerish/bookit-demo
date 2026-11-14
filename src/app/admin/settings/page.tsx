import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import { SettingsForm } from './settings-form';

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await loadClinicSettings(getDatabase());
  return (
    <section>
      <h1>Clinic settings</h1>
      <p>
        <Link href="/admin" prefetch={false} className="underline">
          Back to bookings
        </Link>
      </p>
      <SettingsForm settings={settings} />
    </section>
  );
}
