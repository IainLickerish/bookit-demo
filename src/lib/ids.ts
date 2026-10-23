import { v7 } from 'uuid';
import type { Clock } from './clock';

/** A UUIDv7 whose time part comes from the given clock. */
export function newId(clock: Clock): string {
  return v7({ msecs: clock.now().getTime() });
}
