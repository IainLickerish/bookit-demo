import type { Clock } from '@/lib/clock';
import { createLogger, type Logger } from '@/lib/logger';

export interface CapturedLogs {
  log: Logger;
  lines: Record<string, unknown>[];
  events(): unknown[];
}

/** A logger whose JSON lines are kept in memory for assertions. */
export function captureLogs(clock: Clock, tenant = 'test'): CapturedLogs {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    clock: () => clock,
    tenant,
    environment: 'local',
    destination: {
      write(message: string) {
        for (const line of message.split('\n')) {
          if (line.trim() !== '') {
            lines.push(JSON.parse(line) as Record<string, unknown>);
          }
        }
      },
    },
  });
  return { log, lines, events: () => lines.map((line) => line.event) };
}
