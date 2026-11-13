import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { listAdminPractitioners } from '@/server/admin/bookings';
import { getBlockedTime, listBlockedTime, listBlockCancellations } from '@/server/admin/blocked-time';
import { requireAdmin } from '@/server/admin/context';
import { loadClinicSettings } from '@/server/settings';
import { BLOCKED_TIME_MESSAGES, single, type SearchParams } from '../../messages';
import { BlockForm } from './block-form';

export default async function BlockedTimePage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireAdmin();
  const db = getDatabase();
  const params = await searchParams;
  const before = single(params.before);
  const [settings, practitioners, history, selected] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    listBlockedTime(db, staff.id, before),
    getBlockedTime(db, staff.id, single(params.block)),
  ]);
  const { blocks, nextCursor } = history;
  const cancellations = selected ? await listBlockCancellations(db, staff.id, selected.id) : [];
  const beacon = process.env.BOOKIT_TENANT === 'beacon';
  return (
    <section className="clinic-page">
      <h1>Blocked time</h1>
      <p>Review time away and cancel affected {beacon ? 'appointments' : 'sessions'} before saving.</p>
      <p className="mt-4">
        <Link href="/admin" prefetch={false} className="underline" data-testid="block-back">
          Back to clinic bookings
        </Link>
      </p>
      {params.saved === '1' && selected ? (
        <p role="status" className="notice mt-6" data-testid="block-saved">
          {BLOCKED_TIME_MESSAGES.saved}
        </p>
      ) : null}
      {selected ? (
        <section className="mt-8" aria-labelledby="saved-block-heading" data-testid="block-detail">
          <h2 id="saved-block-heading">Saved blocked time</h2>
          <p>
            {selected.practitionerName}: {formatSlot(selected.startsAt, settings.timeZone)} to{' '}
            {formatSlot(selected.endsAt, settings.timeZone)} ({settings.timeZone}).
          </p>
          <p>{selected.reason || 'No reason given.'}</p>
          <h3 className="mt-4">Cancelled bookings</h3>
          {cancellations.length ? (
            <ul className="space-y-4" data-testid="block-cancellations">
              {cancellations.map((booking) => (
                <li key={booking.id} data-testid="block-cancelled-booking">
                  {booking.patientName}: {formatSlot(booking.startsAt, settings.timeZone)},{' '}
                  {(booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000} minutes. Cancelled.
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="block-no-cancellations">
              No bookings were cancelled by this block. You can review another block below.
            </p>
          )}
        </section>
      ) : params.block ? (
        <p role="alert" className="alert">
          That block could not be found. Choose a saved block below.
        </p>
      ) : null}
      <BlockForm
        practitioners={practitioners}
        timeZone={settings.timeZone}
        practitionerLabel={beacon ? 'Clinician' : 'Physiotherapist'}
        bookingWord={beacon ? 'appointment' : 'session'}
      />
      {practitioners.length === 0 ? (
        <p className="notice">No practitioners are available. Return to clinic bookings.</p>
      ) : null}
      <section className="mt-8" aria-labelledby="saved-blocks-heading">
        <h2 id="saved-blocks-heading">Saved blocks</h2>
        {blocks.length ? (
          <ul className="space-y-4" data-testid="block-list">
            {blocks.map((block) => (
              <li key={block.id} data-testid="block-list-row">
                <Link
                  href={`/admin/blocked-time?block=${block.id}${before ? `&before=${encodeURIComponent(before)}` : ''}`}
                  prefetch={false}
                  className="underline"
                  data-testid="block-open"
                >
                  {block.practitionerName}: {formatSlot(block.startsAt, settings.timeZone)} to{' '}
                  {formatSlot(block.endsAt, settings.timeZone)}
                </Link>
                <p>{block.reason || 'No reason given.'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="block-empty">
            No time is blocked yet. Choose a practitioner and times above to review a block.
          </p>
        )}
        {before || nextCursor ? (
          <nav aria-label="Saved blocks pages" className="mt-6 flex flex-wrap gap-6" data-testid="block-pages">
            {before ? (
              <Link href="/admin/blocked-time" prefetch={false} className="underline" data-testid="block-newest">
                View newest blocks
              </Link>
            ) : null}
            {nextCursor ? (
              <Link
                href={`/admin/blocked-time?before=${nextCursor}`}
                prefetch={false}
                className="underline"
                data-testid="block-older"
              >
                View older blocks
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </section>
  );
}
