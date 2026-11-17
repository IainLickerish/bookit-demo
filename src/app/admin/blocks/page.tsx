import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { requireAdmin } from '@/server/admin/context';
import { listAdminPractitioners } from '@/server/admin/bookings';
import { listAdminBlocks, listAffectedBookings } from '@/server/admin/blocks';
import { loadClinicSettings } from '@/server/settings';
import { noticeText, single, type SearchParams } from '../../messages';
import { BlockForm } from './block-form';

export default async function AdminBlocksPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const db = getDatabase();
  const [settings, practitioners, blocks, params] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    listAdminBlocks(db),
    searchParams,
  ]);
  const affected = await Promise.all(blocks.map((block) => listAffectedBookings(db, block)));
  const practitionerLabel = process.env.BOOKIT_TENANT === 'beacon' ? 'Clinician' : 'Physiotherapist';
  return (
    <section>
      <h1>Block out time</h1>
      <p>Keep time unavailable when a {practitionerLabel.toLowerCase()} is away.</p>
      <p>
        <Link href="/admin" prefetch={false} className="underline" data-testid="blocks-back">
          Back to bookings
        </Link>
      </p>
      {single(params.saved) === '1' ? (
        <p role="status" className="notice" data-testid="block-saved">
          {noticeText('block_saved')}
        </p>
      ) : null}
      <BlockForm practitioners={practitioners} timeZone={settings.timeZone} practitionerLabel={practitionerLabel} />
      <h2>Saved blocked periods</h2>
      {blocks.length === 0 ? (
        <p data-testid="no-blocks">No blocked time saved. Use the form above to block out time.</p>
      ) : (
        <ul className="space-y-6" data-testid="block-list">
          {blocks.map((block, index) => (
            <li key={block.id} className="border-t py-4" data-testid="block-row">
              <h3 className="font-semibold" data-testid="block-name">
                {block.practitionerName}
              </h3>
              <p data-testid="block-period">
                {formatSlot(block.startsAt, settings.timeZone)} to {formatSlot(block.endsAt, settings.timeZone)} (
                {settings.timeZone})
              </p>
              <p className="break-words" data-testid="block-saved-reason">
                {block.reason || 'No reason given.'}
              </p>
              {affected[index]!.length > 0 ? (
                <div role="alert" className="alert mt-4" data-testid="block-warning">
                  <p>
                    These confirmed bookings overlap this blocked period. Contact the clients to arrange another time.
                    No bookings have been cancelled.
                  </p>
                  <ul>
                    {affected[index]!.map((booking) => (
                      <li key={booking.id} className="mt-3" data-testid="block-affected-booking">
                        <p>{booking.patientName}</p>
                        <p>
                          {formatSlot(booking.startsAt, settings.timeZone)} to{' '}
                          {formatSlot(booking.endsAt, settings.timeZone)}. Confirmed.
                        </p>
                        <p className="break-all">Booking reference: {booking.id}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p data-testid="block-no-conflicts">No confirmed bookings overlap this blocked period.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
