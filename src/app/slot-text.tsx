import { formatSlot } from '@/lib/time';

/** Keep the full clinic-local wording while giving its time visual emphasis. */
export function SlotText({ instant, timeZone }: { instant: Date; timeZone: string }) {
  const text = formatSlot(instant, timeZone);
  const timeIndex = text.length - 5;
  return (
    <>
      <span className="slot-date">{text.slice(0, timeIndex)}</span>
      <span className="slot-time" data-testid="slot-time">
        {text.slice(timeIndex)}
      </span>
    </>
  );
}
