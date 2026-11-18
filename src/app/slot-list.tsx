import type { ReactNode } from 'react';
import { formatSlot } from '@/lib/time';
import type { SlotView } from '@/server/slots/queries';

export function SlotList({
  slots,
  timeZone,
  renderChoice,
}: {
  slots: SlotView[];
  timeZone: string;
  renderChoice: (slot: SlotView, label: string) => ReactNode;
}) {
  if (slots.length === 0) {
    return <p data-testid="no-slots">No free times on this day. Try another day.</p>;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="slot-list">
      {slots.map((slot) => (
        <li key={slot.id}>{renderChoice(slot, formatSlot(slot.startsAt, timeZone))}</li>
      ))}
    </ul>
  );
}
