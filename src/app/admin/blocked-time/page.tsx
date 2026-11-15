import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { listBlockedPeriods } from '@/server/admin/blocked-time';
import { listAdminPractitioners } from '@/server/admin/bookings';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import acme from '../../../../tenants/acme.json';
import beacon from '../../../../tenants/beacon.json';
import { BLOCK_MESSAGES, single, type SearchParams } from '../../messages';
import { BlockTimeForm } from './form';

export default async function BlockedTimePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const db = getDatabase();
  const params = await searchParams;
  const [settings, practitioners, { periods, olderCursor, isLatest }] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    listBlockedPeriods(db, { beforeId: single(params.before), fromId: single(params.saved) }),
  ]);
  const tenant = process.env.BOOKIT_TENANT === 'beacon' ? beacon : acme;
  const practitionerLabel = tenant.branding.practitionerLabel;
  const label = practitionerLabel[0]!.toUpperCase() + practitionerLabel.slice(1);
  return (
    <section>
      <h1>Blocked time</h1>
      <p>Keep a {practitionerLabel}’s time unavailable to clients while they are away.</p>
      {periods.some((period) => period.id === params.saved) ? (
        <p className="notice" role="status" data-testid="block-saved">
          {BLOCK_MESSAGES.saved}
        </p>
      ) : null}
      <p>Existing bookings stay confirmed. Check the warnings below and contact any affected clients.</p>
      <BlockTimeForm
        key={typeof params.saved === 'string' ? params.saved : 'new'}
        practitioners={practitioners}
        practitionerLabel={label}
        timeZone={settings.timeZone}
      />
      <h2>Saved blocked periods</h2>
      {periods.length === 0 ? (
        <p data-testid="no-blocks">
          {isLatest
            ? 'No blocked periods yet. Use the form above to add one.'
            : 'No older blocked periods. View the latest periods to continue.'}
        </p>
      ) : (
        <ul className="space-y-6" data-testid="blocked-periods">
          {periods.map((period) => (
            <li key={period.id} className="border-t py-4" data-testid="blocked-period">
              <h3>{period.practitionerName}</h3>
              <p data-testid="block-period-when">
                {formatSlot(period.startsAt, settings.timeZone)} to {formatSlot(period.endsAt, settings.timeZone)} (
                {settings.timeZone})
              </p>
              {period.reason ? <p data-testid="block-period-reason">Reason: {period.reason}</p> : null}
              {period.bookings.length === 0 ? (
                <p data-testid="block-no-bookings">No confirmed bookings overlap this period.</p>
              ) : (
                <div role="status" className="alert" data-testid="block-warning">
                  <p>
                    Confirmed bookings overlap this period. Contact these clients to arrange another time. Their
                    bookings have not been cancelled.
                  </p>
                  <ul>
                    {period.bookings.map((booking) => (
                      <li key={booking.bookingId} data-testid="block-affected-booking">
                        {booking.patientName}:{' '}
                        <span data-testid="block-affected-start">
                          {formatSlot(booking.startsAt, settings.timeZone)}
                        </span>{' '}
                        to {formatSlot(booking.endsAt, settings.timeZone)}. Confirmed.
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Saved blocked periods" className="mt-6 flex flex-wrap gap-4">
        {olderCursor ? (
          <Link
            href={`/admin/blocked-time?before=${olderCursor}`}
            prefetch={false}
            className="button-secondary"
            data-testid="blocks-older"
          >
            View older periods
          </Link>
        ) : null}
        {!isLatest ? (
          <Link href="/admin/blocked-time" prefetch={false} className="button-secondary" data-testid="blocks-latest">
            View latest periods
          </Link>
        ) : null}
      </nav>
      <p className="mt-6">
        <Link href="/admin" prefetch={false} className="underline" data-testid="block-back">
          Back to clinic bookings
        </Link>
      </p>
    </section>
  );
}
