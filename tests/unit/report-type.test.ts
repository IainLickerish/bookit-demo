import { describe, expect, it } from 'vitest';
import { UnknownReportTypeError } from '@/server/admin/report-type';

describe('REQ-15.4-05 DEF-06 report error privacy', () => {
  it('never reflects an address, URL, control character or oversized query value into an SDK error', () => {
    for (const value of [
      'someone@patients.example.test',
      'https://example.test/?token=private',
      'sales\r\nsecret',
      'a'.repeat(100),
    ]) {
      const error = Reflect.construct(UnknownReportTypeError, [value]) as Error;
      expect(error.message.includes(value)).toBe(false);
    }
  });
});
