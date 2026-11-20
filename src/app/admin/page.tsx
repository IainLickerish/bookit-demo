import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatLocalDate, formatSlot, localDateOf } from '@/lib/time';
import { requireAdmin } from '@/server/admin/context';
import {
  listAdminBookings,
  listAdminPractitioners,
  loadDailyWorkload,
  parseBookingFilters,
  type BookingFilters,
} from '@/server/admin/bookings';
import { loadClinicSettings } from '@/server/settings';
import { WORKLOAD_DATE_ERROR, type SearchParams } from '../messages';

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { workloadDate, ...params } = await searchParams;
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
  const [settings, practitioners] = await Promise.all([loadClinicSettings(db), listAdminPractitioners(db)]);
  const today = localDateOf(getClock().now(), settings.timeZone);
  const [rows, workload] = await Promise.all([
    invalid ? [] : listAdminBookings(db, filters, settings.timeZone),
    loadDailyWorkload(db, workloadDate ?? today, settings.timeZone),
  ]);
  const filterEntries = Object.entries(filters);
  const exportQuery = new URLSearchParams(filterEntries).toString();
  const selectedWorkloadDate = workloadDate === undefined ? undefined : workload?.date;
  const clearFiltersHref = selectedWorkloadDate ? `/admin?workloadDate=${selectedWorkloadDate}` : '/admin';
  return (
    <section>
      <h1>Clinic bookings</h1>
      <p>
        <Link href="/admin/settings" prefetch={false} className="underline" data-testid="admin-settings-link">
          Clinic settings
        </Link>
      </p>
      <section aria-labelledby="daily-workload" className="mb-6 border-b border-slate-200 pb-6">
        <h2 id="daily-workload">Daily workload</h2>
        {workload ? (
          <p role="status">
            <strong data-testid="admin-workload-count">
              {workload.confirmed} confirmed {workload.confirmed === 1 ? 'session' : 'sessions'}
            </strong>
            {workload.date === today ? ' today, ' : ' on '}
            <time dateTime={workload.date}>{formatLocalDate(workload.date)}</time>.
          </p>
        ) : null}
        <form
          method="get"
          action="/admin"
          className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,15rem)_auto] sm:items-end sm:justify-start"
        >
          {filterEntries.map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {/* Use the date from the URL when the browser restores this page. */}
          <label className="min-w-0">
            Workload date ({settings.timeZone})
            <input
              key={workload?.date ?? 'invalid'}
              type="date"
              name="workloadDate"
              defaultValue={workload?.date ?? today}
              autoComplete="off"
              required
              aria-invalid={workload ? undefined : true}
              aria-describedby={workload ? undefined : 'workload-date-error'}
              className="min-h-11"
              data-testid="admin-workload-date"
            />
          </label>
          <button className="button-secondary min-h-11" type="submit" data-testid="admin-show-workload">
            Show workload
          </button>
        </form>
        {!workload ? (
          <p id="workload-date-error" role="alert" className="alert mt-3" data-testid="admin-workload-date-error">
            {WORKLOAD_DATE_ERROR}
          </p>
        ) : null}
      </section>
      <form method="get" action="/admin" className="my-6 grid gap-4 sm:grid-cols-3">
        {selectedWorkloadDate ? <input type="hidden" name="workloadDate" value={selectedWorkloadDate} /> : null}
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
        <Link href={clearFiltersHref} prefetch={false} className="button-secondary">
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
