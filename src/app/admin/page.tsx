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
import type { SearchParams } from '../messages';

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
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
  const rows = invalid ? [] : await listAdminBookings(db, filters, settings.timeZone);
  const exportQuery = new URLSearchParams(Object.entries(filters)).toString();
  return (
    <section className="staff-page">
      <header className="page-heading flex flex-wrap items-center justify-between gap-x-6">
        <h1 id="clinic-bookings-title">Clinic bookings</h1>
        <Link href="/admin/settings" prefetch={false} className="text-link" data-testid="admin-settings-link">
          Clinic settings
        </Link>
      </header>
      {invalid ? (
        <p role="alert" className="alert mb-4" data-testid="admin-filter-error">
          Choose a valid practitioner, calendar date and booking status.
        </p>
      ) : null}
      <form method="get" action="/admin" className="card grid gap-4 sm:grid-cols-3">
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-3">
          <button className="button" type="submit" data-testid="admin-filter">
            Filter bookings
          </button>
          <Link href="/admin" prefetch={false} className="text-link">
            Clear filters
          </Link>
        </div>
      </form>
      {!invalid ? (
        <div className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium tabular-nums" role="status" data-testid="admin-row-count">
              {rows.length} bookings
            </p>
            <a href={`/api/admin/export?${exportQuery}`} className="button-secondary" data-testid="admin-export">
              Export filtered bookings (CSV)
            </a>
          </div>
          <div className="card overflow-x-auto p-0" role="region" aria-labelledby="clinic-bookings-title" tabIndex={0}>
            <table className="staff-table">
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
                  <tr key={row.id} data-testid="admin-booking-row">
                    <td>{row.patientName}</td>
                    <td>{row.practitionerName}</td>
                    <td className="tabular-nums">{formatSlot(row.startsAt, settings.timeZone)}</td>
                    <td>
                      <span
                        className={row.status === 'confirmed' ? 'status-pill' : 'status-pill status-pill--cancelled'}
                      >
                        {row.status === 'confirmed'
                          ? 'Confirmed'
                          : row.lateCancellation
                            ? 'Cancelled (late)'
                            : 'Cancelled'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <p className="text-muted" role="status">
              No bookings match these filters.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
