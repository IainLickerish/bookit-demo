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
import { loadTimeBlock, TIME_BLOCK_REASON_LIMIT } from '@/server/admin/time-blocks';
import { withoutQueryDetails } from '@/server/errors';
import { loadClinicSettings } from '@/server/settings';
import { TIME_BLOCK_SAVED, type SearchParams } from '../messages';
import { saveTimeBlockAction } from './time-block-actions';
import { TimeBlockForm } from './time-block-form';

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { timeBlock: timeBlockId, ...params } = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  let filters: BookingFilters = {};
  let invalid = false;
  try {
    filters = parseBookingFilters(query);
  } catch {
    invalid = true;
  }
  const db = getDatabase();
  const [settings, practitioners, timeBlock] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    typeof timeBlockId === 'string'
      ? loadTimeBlock(db, timeBlockId).catch((error: unknown) => {
          throw withoutQueryDetails(error);
        })
      : null,
  ]);
  const rows = invalid ? [] : await listAdminBookings(db, filters, settings.timeZone);
  const exportQuery = new URLSearchParams(Object.entries(filters)).toString();
  return (
    <section>
      <h1>Clinic bookings</h1>
      {timeBlock ? (
        <section id="time-block-result" aria-labelledby="time-block-result-title" data-testid="time-block-result">
          <p role="status" className="notice" data-testid="time-block-saved">
            {TIME_BLOCK_SAVED}
          </p>
          <h2 id="time-block-result-title">Time blocked for {timeBlock.practitionerName}</h2>
          <p className="mb-2 tabular-nums" data-testid="time-block-range">
            {formatSlot(timeBlock.startsAt, settings.timeZone)} to {formatSlot(timeBlock.endsAt, settings.timeZone)} (
            {settings.timeZone})
          </p>
          {timeBlock.reason ? (
            <p className="mb-3 wrap-anywhere" data-testid="time-block-saved-reason">
              Reason: {timeBlock.reason}
            </p>
          ) : null}
          {timeBlock.bookings.length > 0 ? (
            <div className="alert mt-4" data-testid="time-block-warning">
              <h3 className="font-semibold">Confirmed bookings in this time block</h3>
              <p role="alert">These bookings are still confirmed. Please contact the clients listed below.</p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {timeBlock.bookings.map((booking) => (
                  <li key={booking.id} data-testid="time-block-booking">
                    <span className="font-medium">{booking.patientName}</span>
                    <br />
                    <span className="tabular-nums">
                      {formatSlot(booking.startsAt, settings.timeZone)} to{' '}
                      {formatSlot(booking.endsAt, settings.timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mb-4" data-testid="time-block-no-bookings">
              No confirmed bookings overlap this time block.
            </p>
          )}
        </section>
      ) : null}
      <p>
        <Link href="/admin/settings" prefetch={false} className="underline" data-testid="admin-settings-link">
          Clinic settings
        </Link>
      </p>
      <TimeBlockForm
        key={timeBlock?.id}
        practitioners={practitioners.filter((person) => person.active).map(({ id, name }) => ({ id, name }))}
        timeZone={settings.timeZone}
        reasonLimit={TIME_BLOCK_REASON_LIMIT}
        saveAction={saveTimeBlockAction.bind(null, exportQuery)}
      />
      <form method="get" action="/admin" className="my-6 grid gap-4 sm:grid-cols-3">
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
    </section>
  );
}
