import { isUuid } from '@/server/bookings/queries';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/server/auth/session';
import { adminDependencies } from '@/server/admin/context';
import { listTimeBlocks } from '@/server/admin/time-blocks';
import { TimeBlockForm } from './time-block-form';
import { TimeBlockList } from './time-block-list';
import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { formatSlot } from '@/lib/time';
import { requireAdmin } from '@/server/admin/context';
import {
  listAdminBookings,
  listAdminPractitioners,
  parseBookingFilters,
  type BookingFilters,
} from '@/server/admin/bookings';
import { loadClinicSettings } from '@/server/settings';
import { noticeText, type SearchParams } from '../messages';

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const before = params.blocksBefore;
  const invalidBlockPage = Array.isArray(before) || (before !== undefined && !isUuid(before));
  query.delete('blocksBefore');
  query.delete('blockSaved');
  let filters: BookingFilters = {};
  let invalid = false;
  try {
    filters = parseBookingFilters(query);
  } catch {
    invalid = true;
  }
  const db = getDatabase();
  const [settings, practitioners] = await Promise.all([loadClinicSettings(db), listAdminPractitioners(db)]);
  const blockPage = invalidBlockPage
    ? null
    : await listTimeBlocks(
        await adminDependencies(),
        (await cookies()).get(SESSION_COOKIE)?.value,
        before as string | undefined,
      );
  const practitionerLabel = process.env.BOOKIT_TENANT === 'beacon' ? 'Clinician' : 'Physiotherapist';
  const rows = invalid ? [] : await listAdminBookings(db, filters, settings.timeZone);
  const exportQuery = new URLSearchParams(Object.entries(filters)).toString();
  const newestBlocksPath = `/admin${exportQuery ? `?${exportQuery}` : ''}#time-blocks`;
  const olderQuery = new URLSearchParams(Object.entries(filters));
  if (blockPage?.nextCursor) olderQuery.set('blocksBefore', blockPage.nextCursor);
  return (
    <section>
      <h1>Clinic bookings</h1>
      <p>
        <Link href="/admin/settings" prefetch={false} className="underline" data-testid="admin-settings-link">
          Clinic settings
        </Link>
      </p>
      <p className="mt-2">
        <a href="#time-blocks" className="underline" data-testid="admin-time-blocks-link">
          Block out time
        </a>
      </p>
      <form method="get" action="/admin" className="my-6 grid gap-4 sm:grid-cols-3">
        {typeof before === 'string' && !invalidBlockPage ? (
          <input type="hidden" name="blocksBefore" value={before} />
        ) : null}
        <label>
          Practitioner
          <select name="practitionerId" defaultValue={filters.practitionerId ?? ''} data-testid="admin-practitioner">
            <option value="">All practitioners</option>
            {practitioners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date ({settings.timeZone})
          <input type="date" name="date" defaultValue={filters.date ?? ''} data-testid="admin-date" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={filters.status ?? ''} data-testid="admin-status">
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <button className="button" type="submit" data-testid="admin-filter">
          Filter bookings
        </button>
        <Link href="/admin" prefetch={false} className="button-secondary">
          Clear filters
        </Link>
      </form>
      {invalid ? (
        <p role="alert" className="alert" data-testid="admin-filter-error">
          Choose a valid practitioner, calendar date and booking status.
        </p>
      ) : (
        <>
          <p data-testid="admin-row-count">{rows.length} bookings</p>
          <a href={`/api/admin/export?${exportQuery}`} className="button-secondary my-3" data-testid="admin-export">
            Export filtered bookings (CSV)
          </a>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Clinic bookings in {settings.timeZone}</caption>
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Practitioner</th>
                  <th scope="col">Appointment</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t" data-testid="admin-booking-row">
                    <td className="py-3">{row.patientName}</td>
                    <td>{row.practitionerName}</td>
                    <td>{formatSlot(row.startsAt, settings.timeZone)}</td>
                    <td>
                      {row.status === 'confirmed'
                        ? 'Confirmed'
                        : row.lateCancellation
                          ? 'Cancelled (late)'
                          : 'Cancelled'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p>No bookings match these filters.</p> : null}
        </>
      )}
      <section id="time-blocks" className="mt-8" aria-labelledby="time-blocks-heading">
        <h2 id="time-blocks-heading">Block out time</h2>
        <p>
          Stop clients booking time when a {practitionerLabel.toLowerCase()} is away. Any slot that overlaps the block
          will be unavailable. Existing bookings stay confirmed.
        </p>
        {params.blockSaved === '1' ? (
          <p role="status" className="notice" data-testid="time-block-saved">
            {noticeText('time_block_saved')}
          </p>
        ) : null}
        <TimeBlockForm
          practitioners={practitioners}
          timeZone={settings.timeZone}
          practitionerLabel={practitionerLabel}
          returnQuery={before !== undefined ? exportQuery : undefined}
        />
        <h2>Saved time blocks</h2>
        {invalidBlockPage ? (
          <p role="alert" className="alert" data-testid="time-block-page-error">
            Choose a valid page of time blocks. View the newest blocks to continue.
          </p>
        ) : (
          <TimeBlockList blocks={blockPage!.blocks} timeZone={settings.timeZone} />
        )}
        <nav aria-label="Time block pages" className="mt-4 flex gap-4">
          {before !== undefined ? (
            <Link href={newestBlocksPath} prefetch={false} className="underline" data-testid="time-block-newest">
              View newest blocks
            </Link>
          ) : null}
          {blockPage?.nextCursor ? (
            <Link
              href={`/admin?${olderQuery}#time-blocks`}
              prefetch={false}
              className="underline"
              data-testid="time-block-older"
            >
              View older blocks
            </Link>
          ) : null}
        </nav>
      </section>
    </section>
  );
}
