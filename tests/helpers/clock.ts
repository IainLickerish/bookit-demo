import type { Clock } from '@/lib/clock';

export interface ManualClock extends Clock {
  set(instant: string | Date): void;
  advanceMinutes(minutes: number): void;
}

export function manualClock(start: string | Date): ManualClock {
  let current = new Date(start);
  return {
    now: () => new Date(current.getTime()),
    set(instant) {
      current = new Date(instant);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}
