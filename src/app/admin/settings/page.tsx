import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import { SettingsForm } from './settings-form';

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await loadClinicSettings(getDatabase());
  return (
    <section className="reminder-journey">
      <h1>Clinic settings</h1>
      <p>
        <Link href="/admin" prefetch={false} className="underline">
          Back to bookings
        </Link>
      </p>
      <SettingsForm
        values={{
          clinicName: settings.clinicName,
          timeZone: settings.timeZone,
          lateCancellationHours: String(settings.lateCancellationHours),
          includeContactInConfirmation: settings.includeContactInConfirmation,
          remindersEnabled: settings.remindersEnabled,
        }}
      />
    </section>
  );
}
