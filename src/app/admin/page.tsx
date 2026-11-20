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
import { Notice } from '../notice';
import { PageHeader } from '../page-header';

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
    <section className="page page-wide">
      <PageHeader title="Clinic bookings">
        <Link href="/admin/settings" prefetch={false} className="text-action" data-testid="admin-settings-link">
          Clinic settings
        </Link>
      </PageHeader>
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
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button className="button" type="submit" data-testid="admin-filter">
            Filter bookings
          </button>
          <Link href="/admin" prefetch={false} className="button-secondary">
            Clear filters
          </Link>
        </div>
      </form>
      {invalid ? (
        <Notice kind="alert" testId="admin-filter-error">
          Choose a valid practitioner, calendar date and booking status.
        </Notice>
      ) : (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-semibold tabular-nums" role="status" data-testid="admin-row-count">
              {rows.length} bookings
            </p>
            <a href={`/api/admin/export?${exportQuery}`} className="button-secondary" data-testid="admin-export">
              Export filtered bookings (CSV)
            </a>
          </div>
          <div
            className="overflow-x-auto rounded-xl border border-line"
            role="region"
            aria-label="Clinic bookings"
            tabIndex={0}
          >
            <table className="booking-table w-full min-w-[40rem] text-left text-[0.9375rem]">
              <caption className="sr-only">Clinic bookings in {settings.timeZone}</caption>
              <thead className="bg-stone">
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Practitioner</th>
                  <th scope="col">Appointment</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-line" data-testid="admin-booking-row">
                    <td>{row.patientName}</td>
                    <td>{row.practitionerName}</td>
                    <td className="tabular-nums">{formatSlot(row.startsAt, settings.timeZone)}</td>
                    <td>
                      <span className="status-pill" data-status={row.status}>
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
          {rows.length === 0 ? <p className="text-muted">No bookings match these filters.</p> : null}
        </div>
      )}
    </section>
  );
}
