import { expect, it, vi } from 'vitest';
import { formatLocalDate } from '@/lib/time';

it('reuses the date-heading formatter when the selected date crosses a month boundary', () => {
  expect(formatLocalDate('2027-03-31')).toBe('Wednesday, 31 March 2027');
  const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat');

  try {
    expect(formatLocalDate('2027-04-01')).toBe('Thursday, 1 April 2027');
    expect(dateTimeFormat).not.toHaveBeenCalled();
  } finally {
    dateTimeFormat.mockRestore();
  }
});
