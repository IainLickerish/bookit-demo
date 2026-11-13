import type { AdminBooking } from '@/server/admin/bookings';

/** RFC 4180 quoting plus spreadsheet-formula neutralisation for untrusted text. */
export function csvField(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function bookingsCsv(rows: readonly AdminBooking[]): string {
  const header = [
    'Booking ID',
    'Patient',
    'Practitioner',
    'Start (UTC)',
    'End (UTC)',
    'Status',
    'Late cancellation',
    'Phone',
  ];
  const records = rows.map((row) => [
    row.id,
    row.patientName,
    row.practitionerName,
    row.startsAt.toISOString(),
    row.endsAt.toISOString(),
    row.status,
    row.lateCancellation ? 'yes' : 'no',
    row.phone ?? '',
  ]);
  return '\uFEFF' + [header, ...records].map((record) => record.map(csvField).join(',')).join('\r\n') + '\r\n';
}
