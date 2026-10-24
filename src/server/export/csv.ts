import type { AdminBooking } from '@/server/admin/bookings';

export class ExportEncodingError extends Error {
  override readonly name = 'ExportEncodingError';

  constructor() {
    super('Unsupported character in client name');
  }
}

function assertAscii(value: string): void {
  if (/[^\p{ASCII}]/u.test(value)) throw new ExportEncodingError();
}

/** RFC 4180 quoting plus spreadsheet-formula neutralisation for untrusted text. */
export function csvField(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function bookingsCsv(rows: readonly AdminBooking[]): string {
  for (const row of rows) assertAscii(row.patientName);
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
