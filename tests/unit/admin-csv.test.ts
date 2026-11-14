import { describe, expect, it } from 'vitest';
import { parseBookingFilters } from '@/server/admin/bookings';
import { adminSettingsInput } from '@/server/admin/settings';
import { bookingsCsv, csvField } from '@/server/export/csv';
import { adminLogEvidence } from '../helpers/admin-evidence';

describe('M0-24b REQ-18.1-01 REQ-18.1-03 admin CSV and validation', () => {
  it('writes a BOM, RFC 4180 quotes and CRLF records with embedded newlines', () => {
    const csv = bookingsCsv([
      {
        id: 'booking-1',
        patientName: 'Zoë Brontë, "Łukasz"\nSiobhán Ó Briain',
        practitionerId: 'p1',
        practitionerName: 'Pat',
        startsAt: new Date('2026-10-25T09:00:00Z'),
        endsAt: new Date('2026-10-25T09:45:00Z'),
        status: 'confirmed',
        lateCancellation: false,
        phone: null,
      },
    ]);
    const bytes = Buffer.from(csv, 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toBe(csv);
    expect(csv).toContain('"Zoë Brontë, ""Łukasz""\nSiobhán Ó Briain"');
    expect(csv).toContain('"2026-10-25T09:00:00.000Z"');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(bookingsCsv([]).split('\r\n')).toHaveLength(2);
  });
  it.each(['Zoë Brontë', 'Łukasz Wiśniewski', 'Siobhán Ó Briain', '李小明', 'سارة', 'Zoe\u0308'])(
    'preserves Unicode spelling, existing columns and stored values for %s',
    (patientName) => {
      const row = {
        id: 'booking-unicode',
        patientName,
        practitionerId: 'p1',
        practitionerName: 'Dr Élodie, "Clinic"',
        startsAt: new Date('2026-10-25T01:15:00Z'),
        endsAt: new Date('2026-10-25T02:00:00Z'),
        status: 'cancelled' as const,
        lateCancellation: true,
        phone: '+44 7700 900123',
      };
      const before = structuredClone(row);
      const csv = bookingsCsv([row]);
      expect(csv).toBe(
        '\uFEFF"Booking ID","Patient","Practitioner","Start (UTC)","End (UTC)","Status","Late cancellation","Phone"\r\n' +
          `"booking-unicode","${patientName}","Dr Élodie, ""Clinic""","2026-10-25T01:15:00.000Z","2026-10-25T02:00:00.000Z","cancelled","yes","'+44 7700 900123"\r\n`,
      );
      expect(row).toEqual(before);
    },
  );
  it.each(['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '  =HYPERLINK("x")', '\t=1+1', '\r=1+1'])(
    'exports formula-leading text as inert quoted text: %j',
    (value) => {
      expect(csvField(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    },
  );
  it('keeps normal commas, quotes and newlines inside one field', () => {
    expect(csvField('Ada, "Clinic"\nTest')).toBe('"Ada, ""Clinic""\nTest"');
  });
  it('accepts optional filters and rejects invalid, repeated and tenant selectors', () => {
    expect(parseBookingFilters(new URLSearchParams('date=2026-10-25&status=cancelled&practitionerId='))).toEqual({
      date: '2026-10-25',
      status: 'cancelled',
    });
    for (const query of [
      'date=2026-02-30',
      'status=unknown',
      'status=confirmed&status=cancelled',
      'practitionerId=invalid',
      'tenant=beacon',
      'product=BEACON',
      'databaseUrl=foreign',
      '__proto__=foreign',
    ]) {
      expect(() => parseBookingFilters(new URLSearchParams(query)), query).toThrow('Invalid booking filters');
    }
  });
  it('withholds unsafe log content while preserving a failing scan result', () => {
    const canary = 'synthetic-admin-canary';
    const evidence = adminLogEvidence([{ event: 'admin.export', unexpected: canary }], [canary]);
    expect(evidence).toEqual({
      redaction: { passed: false, forbiddenValueCount: 1, checkedValueCount: 1 },
      adminEvents: [],
    });
    expect(JSON.stringify(evidence)).not.toContain(canary);
  });
  it('validates settings without permitting changes to other booking rules', () => {
    const valid = {
      clinicName: 'Demo Clinic',
      timeZone: 'Europe/London',
      lateCancellationHours: 48,
      includeContactInConfirmation: false,
    };
    expect(adminSettingsInput.parse(valid)).toEqual(valid);
    for (const change of [
      { clinicName: '' },
      { timeZone: 'invalid' },
      { lateCancellationHours: -1 },
      { lateCancellationHours: 1.5 },
      { lateCancellationHours: 337 },
      { slotHorizonDays: 1 },
    ]) {
      expect(adminSettingsInput.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });
});
