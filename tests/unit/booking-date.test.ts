import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { expect, test } from 'vitest';
import { DayPicker } from '@/app/day-picker';
import type { DayView } from '@/server/slots/day-view';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

type ControlProps = { children?: ReactNode; 'data-testid'?: string };

function findControl(tree: ReactNode, testId: string): ReactElement<ControlProps> | undefined {
  let match: ReactElement<ControlProps> | undefined;
  Children.forEach(tree, (child) => {
    if (match || !isValidElement<ControlProps>(child)) return;
    match = child.props['data-testid'] === testId ? child : findControl(child.props.children, testId);
  });
  return match;
}

function bookingPicker(date: string) {
  const view: DayView = {
    date,
    today: '2026-11-17',
    lastDate: '2026-11-30',
    settings: TEST_CLINIC_SETTINGS,
    practitioners: [],
    practitioner: null,
    slots: [],
  };
  return DayPicker({ view, path: '/slots' });
}

test.each([
  ['Next day', 'next-day', '2026-11-17', '2026-11-18', 'Wednesday, 18 November 2026'],
  ['Previous day', 'previous-day', '2026-11-18', '2026-11-17', 'Tuesday, 17 November 2026'],
  ['Next day after choosing another date', 'next-day', '2026-11-19', '2026-11-20', 'Friday, 20 November 2026'],
])('the date field follows %s', (_name, linkId, before, after, heading) => {
  const current = bookingPicker(before);
  const updated = bookingPicker(after);
  const currentField = findControl(current, 'date-input');
  const updatedField = findControl(updated, 'date-input');

  expect(findControl(current, linkId)?.props).toMatchObject({ href: `/slots?practitioner=&date=${after}` });
  expect(currentField?.props).toMatchObject({ defaultValue: before });
  expect(findControl(updated, 'shown-date')?.props.children).toBe(heading);
  expect(updatedField?.props).toMatchObject({ defaultValue: after });
  // The date field is uncontrolled. Reusing it would keep any edit to its value.
  expect(updatedField?.key).not.toBe(currentField?.key);
});
