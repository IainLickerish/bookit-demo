import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { listAdminPractitioners } from '@/server/admin/bookings';
import { requireAdmin } from '@/server/admin/context';
import { listTimeBlocks } from '@/server/admin/time-blocks';
import { loadClinicSettings } from '@/server/settings';
import { BLOCK_MESSAGES, single, type SearchParams } from '../../messages';
import { BlockForm } from './block-form';

export default async function BlockedTimePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const db = getDatabase();
  const [settings, practitioners, blocks, params] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    listTimeBlocks(db),
    searchParams,
  ]);
  const practitionerLabel = process.env.BOOKIT_TENANT === 'beacon' ? 'Clinician' : 'Physiotherapist';
  const saved = blocks.some((block) => block.id === single(params.saved));
  return (
    <section className="staff-page">
      <h1>Blocked time</h1>
      <p className="mb-6">Keep time free when a {practitionerLabel.toLowerCase()} is away.</p>
      {saved ? (
        <p role="status" className="notice" data-testid="block-saved">
          <span aria-hidden="true">✓ </span>
          {BLOCK_MESSAGES.saved}
        </p>
      ) : null}
      <div className="staff-card">
        <h2 className="mt-0">Block out time</h2>
        <BlockForm practitioners={practitioners} practitionerLabel={practitionerLabel} timeZone={settings.timeZone} />
      </div>
      <h2>Saved blocks</h2>
      <p className="mb-4 text-sm">Clients cannot book or move into these times. Existing bookings stay confirmed.</p>
      {blocks.length === 0 ? (
        <p data-testid="no-blocks">No blocked time saved. Use the form above to add a block.</p>
      ) : (
        <ul className="space-y-6" data-testid="block-list">
          {blocks.map((block) => (
            <li key={block.id} className="staff-card" data-testid="block-row">
              <h3 className="text-lg font-semibold">{block.practitionerName}</h3>
              <dl className="my-4 space-y-2 tabular-nums">
                <div>
                  <dt className="inline font-medium">Start: </dt>
                  <dd className="inline" data-testid="block-saved-start">
                    {formatSlot(block.startsAt, settings.timeZone)}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">End: </dt>
                  <dd className="inline" data-testid="block-saved-end">
                    {formatSlot(block.endsAt, settings.timeZone)}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">Reason: </dt>
                  <dd className="inline break-words" data-testid="block-saved-reason">
                    {block.reason ?? 'No reason given.'}
                  </dd>
                </div>
              </dl>
              {block.affected.length ? (
                <div role="status">
                  <p className="attention" data-testid="block-conflicts">
                    <span aria-hidden="true">⚠ </span>
                    {BLOCK_MESSAGES.conflicts}
                  </p>
                  <ul className="mt-4 space-y-4" data-testid="block-affected-list">
                    {block.affected.map((booking) => (
                      <li key={booking.id} data-testid="block-affected-booking">
                        <p className="font-medium">{booking.patientName}</p>
                        <p>{booking.practitionerName}</p>
                        <p className="tabular-nums">
                          {formatSlot(booking.startsAt, settings.timeZone)} to{' '}
                          {formatSlot(booking.endsAt, settings.timeZone)}
                        </p>
                        <p>Booking reference: {booking.id}</p>
                        <p>Confirmed</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p role="status" className="notice" data-testid="block-no-conflicts">
                  {BLOCK_MESSAGES.noConflicts}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-8">
        <Link href="/admin" prefetch={false} className="button-secondary" data-testid="blocks-back">
          Back to clinic bookings
        </Link>
      </p>
    </section>
  );
}
