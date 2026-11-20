import type { ReactNode } from 'react';
import { formatSlot } from '@/lib/time';
import type { SlotView } from '@/server/slots/queries';

export function SlotList({
  slots,
  timeZone,
  renderChoice,
  emptyMessage = 'No free times on this day. Try another day.',
}: {
  slots: SlotView[];
  timeZone: string;
  renderChoice: (slot: SlotView, label: string) => ReactNode;
  emptyMessage?: string;
}) {
  if (slots.length === 0) {
    return (
      <p className="empty-times" role="status" data-testid="no-slots">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="slot-list">
      {slots.map((slot) => (
        <li key={slot.id}>{renderChoice(slot, formatSlot(slot.startsAt, timeZone))}</li>
      ))}
    </ul>
  );
}
