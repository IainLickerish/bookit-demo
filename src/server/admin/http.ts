import type { BookingDependencies } from '@/server/bookings/book';
import { findSessionUser } from '@/server/auth/session';
import { loadClinicSettings } from '@/server/settings';
import { bookingsCsv, ExportEncodingError } from '@/server/export/csv';
import { reportError } from '@/server/error-reporting';
import { listAdminBookings, parseBookingFilters } from './bookings';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export type AdminReportDependencies = Pick<BookingDependencies, 'db' | 'clock' | 'log'>;

export async function adminReportResponse(
  deps: AdminReportDependencies,
  token: string | undefined,
  params: URLSearchParams,
  format: 'csv' | 'report',
): Promise<Response> {
  try {
    const user = token ? await findSessionUser(deps.db, deps.clock, token) : null;
    if (!user || user.role !== 'admin') {
      const status = user ? 403 : 401;
      deps.log.info({ event: 'admin.access_refused', status }, 'Admin access refused');
      return new Response(user ? 'Admin access required' : 'Sign-in required', { status, headers: privateHeaders });
    }
    const query = new URLSearchParams(params);
    const type = format === 'csv' ? 'bookings' : query.get('type');
    if (format === 'report') {
      if (query.getAll('type').length !== 1 || !['bookings', 'summary'].includes(type ?? '')) {
        return new Response('Unknown report type', { status: 400, headers: privateHeaders });
      }
      query.delete('type');
    }
    let filters;
    try {
      filters = parseBookingFilters(query);
    } catch {
      return new Response('Invalid booking filters', { status: 400, headers: privateHeaders });
    }
    const settings = await loadClinicSettings(deps.db);
    const rows = await listAdminBookings(deps.db, filters, settings.timeZone);
    deps.log.info(
      { event: format === 'csv' ? 'admin.export' : 'admin.report', row_count: rows.length, report_type: type },
      'Admin report created',
    );
    if (format === 'csv') {
      return new Response(bookingsCsv(rows), {
        headers: {
          ...privateHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="bookings.csv"',
        },
      });
    }
    const data =
      type === 'summary'
        ? {
            total: rows.length,
            confirmed: rows.filter((row) => row.status === 'confirmed').length,
            cancelled: rows.filter((row) => row.status === 'cancelled').length,
            lateCancellations: rows.filter((row) => row.lateCancellation).length,
          }
        : { bookings: rows };
    return Response.json(data, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof ExportEncodingError) reportError(error, { operation: 'admin.export' });
    // Database/provider exceptions may include bound personal data. Do not log them.
    deps.log.error({ event: 'admin.report_failed' }, 'Admin report unavailable');
    return new Response('Report unavailable', { status: 500, headers: privateHeaders });
  }
}
