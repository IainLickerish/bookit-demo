import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { requireAdmin } from '@/server/admin/context';
import {
  countConfirmedBookingsToday,
  listAdminBookings,
  listAdminPractitioners,
  parseBookingFilters,
  type BookingFilters,
} from '@/server/admin/bookings';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';
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
  const [rows, confirmedToday] = await Promise.all([
    invalid ? [] : listAdminBookings(db, filters, settings.timeZone),
    countConfirmedBookingsToday(db, getClock(), settings.timeZone).catch(async (error: unknown) => {
      const log = await requestLogger();
      log.error({ event: 'admin.daily_count_failed' }, 'Daily confirmed count unavailable');
      throw withoutQueryDetails(error);
    }),
  ]);
  const exportQuery = new URLSearchParams(Object.entries(filters)).toString();
  return (
    <section>
      <h1>Clinic bookings</h1>
      <p className="notice" data-testid="admin-today-confirmed-count">
        {confirmedToday === 0
          ? 'No confirmed sessions today.'
          : `${confirmedToday} confirmed ${confirmedToday === 1 ? 'session' : 'sessions'} today.`}
      </p>
      <p>
        <Link href="/admin/settings" prefetch={false} className="underline" data-testid="admin-settings-link">
          Clinic settings
        </Link>
      </p>
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
